import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  lstatSync,
  unlinkSync,
  openSync,
  closeSync,
} from 'node:fs';
import { resolve, join } from 'node:path';

export const DEFAULT_POLICY = {
  minIntervalMs: 1000,
  maxRequests: 100,
  maxBytes: 10 * 1024 * 1024,
  timeoutMs: 30000,
  cacheTtlMs: 600000,
  blockedCooldownMs: 900000,
  maxRedirects: 3,
  hosts: {},
};
export class NetworkPolicyError extends Error {
  constructor(message, code, retryAt) {
    super(message);
    this.code = code;
    this.retryAt = retryAt;
  }
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
function cacheDuration(control, ceiling, age = 0) {
  if (/no-cache|no-store/i.test(control || '')) return 0;
  const maxAge = control?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1];
  return maxAge === undefined
    ? ceiling
    : Math.min(ceiling, Math.max(0, Number(maxAge) * 1000 - Math.max(0, Number(age) || 0) * 1000));
}
const read = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
};
function checkedFile(path) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error('Network state/cache paths cannot be symlinks.');
  return path;
}
function save(path, value) {
  checkedFile(path);
  const temp = checkedFile(`${path}.tmp`);
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temp, path);
}
function publicUrl(raw) {
  const url = new URL(raw),
    host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.includes(':') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  )
    throw new NetworkPolicyError(
      'Use a public HTTPS hostname without URL credentials, localhost names or IP literals.',
      'URL_POLICY',
    );
  url.hostname = host;
  url.hash = '';
  return url;
}
function retryTime(value, now, secondsOnly = false) {
  if (!value) return undefined;
  const number = Number(value.split(';')[0]);
  if (Number.isFinite(number))
    return !secondsOnly && number > 1000000000 ? number * 1000 : now + Math.max(0, number) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : undefined;
}
function numberOption(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(
      `${name} must be ${min}–${max}; received ${value}. Edit tools/network-policy.json.`,
    );
  return value;
}

/** GET-only connector. One in-flight request per client; per-host pacing and
 * blocked/reset times survive runs. Agent-authored clients should reuse it. */
export class ProjectNetwork {
  constructor({
    directory = '.workroom-http',
    policy = {},
    fetchImpl = fetch,
    now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    onEvent = () => {},
  } = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy, hosts: policy.hosts || {} };
    numberOption(this.policy.maxRequests, 'maxRequests', 1, 10000);
    this.directory = resolve(directory);
    if (existsSync(this.directory) && lstatSync(this.directory).isSymbolicLink())
      throw new Error('Network state directory cannot be a symlink.');
    mkdirSync(this.directory, { recursive: true });
    this.statePath = checkedFile(join(this.directory, 'hosts.json'));
    this.lockPath = join(this.directory, 'request.lock');
    this.state = read(this.statePath, {});
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.sleep = sleep;
    this.onEvent = onEvent;
    this.requests = 0;
    this.hostRequests = {};
    this.queue = Promise.resolve();
  }
  get(raw, options = {}) {
    const job = this.queue.then(() => this.withLock(() => this.request(raw, options)));
    this.queue = job.catch(() => {});
    return job;
  }
  async withLock(run) {
    const token = `${process.pid}:${digest(String(this.now()) + Math.random())}`;
    let fd;
    try {
      fd = openSync(this.lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST')
        throw new NetworkPolicyError(
          'Another project network tool holds .workroom-http/request.lock. No request sent. Wait for it to finish; inspect a leftover lock before clearing it after a crashed process.',
          'NETWORK_BUSY',
        );
      throw error;
    }
    try {
      writeFileSync(fd, JSON.stringify({ token, pid: process.pid, createdAt: this.now() }));
    } finally {
      closeSync(fd);
    }
    try {
      return await run();
    } finally {
      if (
        existsSync(this.lockPath) &&
        !lstatSync(this.lockPath).isSymbolicLink() &&
        read(this.lockPath, {}).token === token
      )
        unlinkSync(this.lockPath);
    }
  }
  async request(raw, { accept = '*/*', allowRedirect } = {}) {
    let url = publicUrl(raw);
    for (let redirects = 0; ; redirects++) {
      const host = url.hostname,
        rules = { ...this.policy, ...this.policy.hosts[host] };
      if (rules.access !== undefined && !['public', 'api-only', 'blocked'].includes(rules.access))
        throw new NetworkPolicyError(
          `Invalid access rule for ${host}; use public, api-only or blocked in network-policy.json.`,
          'SOURCE_POLICY',
        );
      for (const key of ['disallowPaths', 'preferredSources'])
        if (
          rules[key] !== undefined &&
          (!Array.isArray(rules[key]) || rules[key].some((value) => typeof value !== 'string'))
        )
          throw new NetworkPolicyError(
            `Invalid ${key} for ${host}; use an array of strings in network-policy.json.`,
            'SOURCE_POLICY',
          );
      const alternatives = (rules.preferredSources || []).join(', ');
      if (
        rules.access === 'blocked' ||
        rules.access === 'api-only' ||
        (rules.disallowPaths || []).some((path) => url.pathname.startsWith(path))
      )
        throw new NetworkPolicyError(
          `Direct access to ${host}${url.pathname} is disabled by project policy. ${alternatives ? `Use configured API/cache/dataset sources: ${alternatives}` : 'Research the official API or permitted alternative source and update the policy.'}`,
          'SOURCE_POLICY',
        );
      const interval = numberOption(rules.minIntervalMs, 'minIntervalMs', 250, 3600000);
      numberOption(rules.maxRequests, 'maxRequests', 1, 10000);
      numberOption(rules.maxBytes, 'maxBytes', 1, 100 * 1024 * 1024);
      numberOption(rules.timeoutMs, 'timeoutMs', 1000, 300000);
      numberOption(rules.cacheTtlMs, 'cacheTtlMs', 0, 86400000);
      numberOption(rules.blockedCooldownMs, 'blockedCooldownMs', 1000, 86400000);
      numberOption(rules.maxRedirects, 'maxRedirects', 0, 10);
      const key = digest(`${url.href}\n${accept}`),
        cachePath = checkedFile(join(this.directory, `${key}.json`));
      const cached = rules.cacheTtlMs > 0 ? read(cachePath, undefined) : undefined;
      if (rules.cacheTtlMs > 0 && cached?.expiresAt > this.now()) {
        const bytes = Buffer.from(cached.body, 'base64');
        if (bytes.length <= rules.maxBytes && digest(bytes) === cached.sha256) {
          this.onEvent({ type: 'cache', host, url: url.origin + url.pathname });
          return { ...cached, bytes, cacheHit: true };
        }
      }
      // Reload persisted host state so successive tool invocations honor blocks.
      this.state = read(this.statePath, this.state);
      const state = this.state[host] || {};
      if (state.blockedUntil > this.now())
        throw new NetworkPolicyError(
          `${host} is paused until ${new Date(state.blockedUntil).toISOString()} after ${state.reason || 'rate-limit feedback'}. No request was sent.`,
          'HOST_PAUSED',
          state.blockedUntil,
        );
      if (this.requests >= this.policy.maxRequests)
        throw new NetworkPolicyError(
          `Network request budget ${this.policy.maxRequests} reached; no further request sent. Adjust maxRequests deliberately.`,
          'REQUEST_LIMIT',
        );
      if ((this.hostRequests[host] || 0) >= rules.maxRequests)
        throw new NetworkPolicyError(
          `Host request budget ${rules.maxRequests} reached for ${host}; no request sent.`,
          'REQUEST_LIMIT',
        );
      const wait = Math.max(
        0,
        Math.max(state.nextAt || 0, state.lastAt === undefined ? 0 : state.lastAt + interval) -
          this.now(),
      );
      if (wait) {
        this.onEvent({ type: 'paced', host, waitMs: wait });
        await this.sleep(wait);
      }
      const headers = { Accept: accept, 'User-Agent': 'WorkroomProjectTool/1.0' };
      if (rules.userAgent !== undefined) {
        if (
          typeof rules.userAgent !== 'string' ||
          !rules.userAgent.trim() ||
          rules.userAgent.length > 240 ||
          /[\r\n]/.test(rules.userAgent)
        )
          throw new Error(
            'userAgent must be an honest application identifier/contact string of 1–240 characters without newlines.',
          );
        headers['User-Agent'] = rules.userAgent;
      }
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
      this.requests++;
      this.hostRequests[host] = (this.hostRequests[host] || 0) + 1;
      this.state[host] = { ...state, lastAt: this.now(), nextAt: this.now() + interval };
      save(this.statePath, this.state);
      let response;
      try {
        response = await this.fetchImpl(url.href, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(rules.timeoutMs),
        });
      } catch (error) {
        this.state[host].blockedUntil = this.now() + rules.blockedCooldownMs;
        this.state[host].reason = 'transport failure';
        save(this.statePath, this.state);
        throw new NetworkPolicyError(
          `Transport failed for ${host}: ${error.message}. Host paused; no automatic retry.`,
          'TRANSPORT_ERROR',
          this.state[host].blockedUntil,
        );
      }
      const now = this.now(),
        next = this.state[host];
      const remaining =
        response.headers.get('RateLimit-Remaining') ??
        response.headers.get('X-RateLimit-Remaining');
      const reset = retryTime(
        response.headers.get('X-RateLimit-Reset') || response.headers.get('RateLimit-Reset'),
        now,
      );
      const retryAt = retryTime(response.headers.get('Retry-After'), now, true);
      if (remaining !== null && reset) {
        const count = Number(remaining);
        if (count === 0) {
          next.blockedUntil = Math.max(reset + 1000, now + interval);
          next.reason = 'the server reported zero remaining requests';
        } else if (count > 0)
          next.nextAt = Math.max(next.nextAt, now + Math.ceil((reset - now) / count));
      }
      if ([401, 403, 429].includes(response.status) || response.status >= 500) {
        next.blockedUntil = Math.max(
          next.blockedUntil || 0,
          retryAt || now + rules.blockedCooldownMs,
        );
        next.reason = `HTTP ${response.status}`;
        save(this.statePath, this.state);
        await response.body?.cancel();
        throw new NetworkPolicyError(
          `${host} returned HTTP ${response.status}. Host paused; no automatic retry. ${response.status === 403 || response.status === 401 ? 'Check access policy, authentication, official API or permitted cache/dataset source.' : 'Honor the server limit before resuming.'}`,
          `HTTP_${response.status}`,
          next.blockedUntil,
        );
      }
      save(this.statePath, this.state);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        await response.body?.cancel();
        if (!location || redirects >= rules.maxRedirects)
          throw new NetworkPolicyError(
            `Redirect allowance ${rules.maxRedirects} exhausted or Location missing.`,
            'REDIRECT_LIMIT',
          );
        const redirected = publicUrl(new URL(location, url).href);
        if (allowRedirect && !allowRedirect(redirected))
          throw new NetworkPolicyError(
            'Redirect rejected by the caller scope/robots policy. No request sent to the redirect destination.',
            'REDIRECT_POLICY',
          );
        url = redirected;
        continue;
      }
      if (response.status === 304 && cached) {
        const bytes = Buffer.from(cached.body, 'base64');
        if (bytes.length > rules.maxBytes || digest(bytes) !== cached.sha256)
          throw new Error('Cached data failed integrity/size checks.');
        cached.cacheControl = response.headers.get('Cache-Control') ?? cached.cacheControl;
        cached.expiresAt =
          now + cacheDuration(cached.cacheControl, rules.cacheTtlMs, response.headers.get('Age'));
        if (/no-store/i.test(cached.cacheControl || '')) {
          if (existsSync(cachePath)) unlinkSync(cachePath);
        } else save(cachePath, cached);
        return { ...cached, bytes, cacheHit: true };
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new NetworkPolicyError(
          `${host} returned HTTP ${response.status}; no retry.`,
          `HTTP_${response.status}`,
        );
      }
      const chunks = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader)
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > rules.maxBytes)
              throw new NetworkPolicyError(
                `Response exceeded maxBytes ${rules.maxBytes}.`,
                'SIZE_LIMIT',
              );
            chunks.push(value);
          }
        } catch (error) {
          if (error instanceof NetworkPolicyError) throw error;
          this.state[host].blockedUntil = this.now() + rules.blockedCooldownMs;
          this.state[host].reason = 'response stream failure';
          save(this.statePath, this.state);
          throw new NetworkPolicyError(
            `Response stream failed for ${host}: ${error.message}. Host paused; partial bytes were not cached.`,
            'TRANSPORT_ERROR',
            this.state[host].blockedUntil,
          );
        } finally {
          await reader.cancel().catch(() => {});
        }
      const bytes = Buffer.concat(chunks);
      const entry = {
        url: url.href,
        contentType: response.headers.get('Content-Type') || '',
        body: bytes.toString('base64'),
        sha256: digest(bytes),
        etag: response.headers.get('ETag'),
        lastModified: response.headers.get('Last-Modified'),
        robotsTag: response.headers.get('X-Robots-Tag') || '',
        fetchedAt: now,
        cacheControl: response.headers.get('Cache-Control'),
        expiresAt:
          now +
          cacheDuration(
            response.headers.get('Cache-Control'),
            rules.cacheTtlMs,
            response.headers.get('Age'),
          ),
      };
      if (!/no-store/i.test(response.headers.get('Cache-Control') || '') && rules.cacheTtlMs > 0)
        save(cachePath, entry);
      else if (existsSync(cachePath)) unlinkSync(cachePath);
      this.onEvent({ type: 'received', host, bytes: bytes.length, status: response.status });
      return { ...entry, bytes, cacheHit: false };
    }
  }
  forget(raw, { accept = '*/*' } = {}) {
    const url = publicUrl(raw),
      key = digest(`${url.href}\n${accept}`);
    const path = checkedFile(join(this.directory, `${key}.json`));
    if (existsSync(path)) unlinkSync(path);
  }
}
