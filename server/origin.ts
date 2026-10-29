import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function configured(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}
export function allowedHost(host: string | undefined, configuredOrigin?: string) {
  if (!host || /[\s,@/#?\\]/.test(host)) return false;
  try {
    const parsed = new URL(`http://${host}`);
    return (
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      parsed.host === configured(configuredOrigin)?.host
    );
  } catch {
    return false;
  }
}
export function allowedOrigin(origin: string, host: string | undefined, configuredOrigin?: string) {
  if (!allowedHost(host, configuredOrigin)) return false;
  const requested = configured(origin);
  return (
    !!requested &&
    (requested.host === host || requested.origin === configured(configuredOrigin)?.origin)
  );
}

// A signed, expiring double-submit token binds writes to a same-origin browser
// session. No server-side session list or persistent bearer credential is exposed.
export class BrowserSessions {
  private secret = randomBytes(32);
  private valid(token: string | undefined) {
    if (!token || token.length > 200) return false;
    const [nonce, expiry, signature, extra] = token.split('.');
    if (extra || !nonce || !/^\d+$/.test(expiry || '') || Number(expiry) <= Date.now())
      return false;
    const expected = createHmac('sha256', this.secret).update(`${nonce}.${expiry}`).digest('hex');
    return (
      !!signature &&
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  }
  cookie(value?: string) {
    return value
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('workroom_session='))
      ?.slice('workroom_session='.length);
  }
  issue(cookie?: string) {
    const current = this.cookie(cookie);
    if (this.valid(current)) return current!;
    const payload = `${randomBytes(24).toString('hex')}.${Date.now() + 12 * 3600_000}`;
    return `${payload}.${createHmac('sha256', this.secret).update(payload).digest('hex')}`;
  }
  accepts(cookie: string | undefined, header: string | undefined) {
    const token = this.cookie(cookie);
    return (
      this.valid(token) &&
      !!header &&
      header.length === token!.length &&
      timingSafeEqual(Buffer.from(header), Buffer.from(token!))
    );
  }
}
