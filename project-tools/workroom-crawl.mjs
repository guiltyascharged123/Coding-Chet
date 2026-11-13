import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectNetwork } from './network.mjs';
import { projectPath } from './workroom-download.mjs';

const read = (path, fallback) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
function save(root, path, value) {
  const destination = projectPath(root, path),
    temp = projectPath(root, `${path}.tmp`);
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, destination);
}
const decode = (value) =>
  value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (!entity.startsWith('#'))
      return (
        { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()] || all
      );
    const code =
      entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
const text = (html) =>
  decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
function attribute(tag, name) {
  const match = tag.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? decode(match[1] ?? match[2] ?? match[3] ?? '') : '';
}
export function robotsRules(source, agent = 'WorkroomProjectTool') {
  if (/<html\b/i.test(source))
    throw new Error(
      'robots.txt returned HTML rather than a robots policy. Inspect the source before crawling.',
    );
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(source))
    throw new Error('robots.txt is not readable text; inspect access policy before crawling.');
  const groups = [];
  let group,
    hasRules = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(),
      split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase(),
      value = line.slice(split + 1).trim();
    if (key === 'user-agent') {
      if (!group || hasRules) {
        group = { agents: [], rules: [], delayMs: 0 };
        groups.push(group);
        hasRules = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group) {
      hasRules = true;
      if (['allow', 'disallow'].includes(key) && value)
        group.rules.push({ allow: key === 'allow', path: value });
      if (key === 'crawl-delay' && Number.isFinite(Number(value)) && Number(value) >= 0)
        group.delayMs = Math.max(group.delayMs, Number(value) * 1000);
    }
  }
  const token = agent.toLowerCase().split('/')[0],
    specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const selected = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: selected.flatMap((g) => g.rules),
    delayMs: Math.max(0, ...selected.map((g) => g.delayMs)),
  };
}
export function robotsAllows(policy, url) {
  const value = new URL(url),
    path = value.pathname + value.search;
  const matches = policy.rules
    .filter((rule) => {
      const end = rule.path.endsWith('$');
      const pattern = (end ? rule.path.slice(0, -1) : rule.path)
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp(`^${pattern}${end ? '$' : ''}`).test(path);
    })
    .sort(
      (a, b) =>
        b.path.replace(/\*/g, '').length - a.path.replace(/\*/g, '').length ||
        Number(b.allow) - Number(a.allow),
    );
  return !matches.length || matches[0].allow;
}
export async function crawlSite(options = {}) {
  const root = realpathSync(options.root || process.cwd()),
    folder = projectPath(root, options.output || 'site-index');
  mkdirSync(folder, { recursive: true });
  const lock = projectPath(root, join(folder, 'crawl.lock'));
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'This output folder is already being crawled. Wait for it to finish; inspect a stale crawl.lock after a crashed process.',
      );
    throw error;
  }
  try {
    return await crawlUnlocked({ ...options, root });
  } finally {
    unlinkSync(lock);
  }
}
async function crawlUnlocked({
  start,
  output = 'site-index',
  root = process.cwd(),
  policy = {},
  maxPages = 25,
  maxDepth = 2,
  maxTextChars = 100000,
  robotsMode = policy.crawlRobots || 'ignore',
  client,
} = {}) {
  root = realpathSync(root);
  const origin = new URL(start);
  if (origin.protocol !== 'https:' || origin.username || origin.password)
    throw new Error('Start with a public HTTPS URL without credentials.');
  if (!['ignore', 'respect'].includes(robotsMode))
    throw new Error('robotsMode / crawlRobots must be ignore or respect.');
  for (const [value, name, min, max] of [
    [maxPages, 'maxPages', 1, 1000],
    [maxDepth, 'maxDepth', 0, 10],
    [maxTextChars, 'maxTextChars', 1000, 1000000],
  ])
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be ${min}–${max}.`);
  origin.hash = '';
  const prefix = origin.pathname.endsWith('/')
    ? origin.pathname
    : origin.pathname.slice(0, origin.pathname.lastIndexOf('/') + 1);
  const folder = projectPath(root, output);
  mkdirSync(folder, { recursive: true });
  const checkpoint = join(folder, 'crawl-state.json'),
    indexPath = join(folder, 'search-index.json');
  projectPath(root, checkpoint);
  projectPath(root, indexPath);
  const network =
    client ||
    new ProjectNetwork({
      directory: projectPath(root, '.workroom-http'),
      policy,
      onEvent: (event) => console.log(JSON.stringify(event)),
    });
  const state = read(checkpoint, {
    start: origin.href,
    robotsMode,
    pages: [],
    seen: [],
    queue: [{ url: origin.href, depth: 0 }],
    skipped: [],
    failures: [],
  });
  if (
    state.start !== origin.href ||
    state.robotsMode !== robotsMode ||
    !['pages', 'queue', 'seen', 'skipped', 'failures'].every((key) => Array.isArray(state[key]))
  )
    throw new Error(
      'The saved crawl belongs to another start URL/robots setting or is invalid. Use a new output folder.',
    );
  state.processed ??= state.seen.length;
  if (
    !Number.isInteger(state.processed) ||
    state.processed < 0 ||
    state.queue.some((item) => {
      try {
        const url = new URL(item.url);
        return (
          url.origin !== origin.origin ||
          !url.pathname.startsWith(prefix) ||
          !Number.isInteger(item.depth) ||
          item.depth < 0 ||
          item.depth > 10
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error('Invalid saved crawl queue/count. Preserve it and choose a new output folder.');
  let robots = { rules: [], delayMs: 0 },
    stopped;
  try {
    if (robotsMode === 'respect') {
      try {
        const response = await network.get(new URL('/robots.txt', origin).href, {
          accept: 'text/plain',
          allowRedirect: (url) => url.origin === origin.origin,
        });
        robots = robotsRules(
          response.bytes.toString('utf8'),
          network.policy.hosts[origin.hostname]?.userAgent ||
            network.policy.userAgent ||
            'WorkroomProjectTool',
        );
      } catch (error) {
        if (error.code !== 'HTTP_404') throw error;
      }
      network.policy.hosts[origin.hostname] = {
        ...network.policy.hosts[origin.hostname],
        minIntervalMs: Math.max(
          network.policy.hosts[origin.hostname]?.minIntervalMs || network.policy.minIntervalMs,
          robots.delayMs,
        ),
      };
    }
    while (state.queue.length && state.processed < maxPages) {
      const next = state.queue.shift(),
        url = new URL(next.url);
      if (state.seen.includes(url.href) || next.depth > maxDepth) continue;
      state.processed++;
      if (!robotsAllows(robots, url.href)) {
        state.seen.push(url.href);
        state.skipped.push({ url: url.href, reason: 'robots disallow' });
        continue;
      }
      try {
        const resource = await network.get(url.href, {
          accept: 'text/html,application/xhtml+xml',
          allowRedirect: (target) =>
            target.origin === origin.origin &&
            target.pathname.startsWith(prefix) &&
            robotsAllows(robots, target.href),
        });
        if (!/text\/html|application\/xhtml\+xml/i.test(resource.contentType)) {
          state.seen.push(url.href);
          state.skipped.push({
            url: url.href,
            reason: 'not HTML; use an appropriate data connector',
          });
          continue;
        }
        const html = resource.bytes
          .toString('utf8')
          .replace(/<!--[\s\S]*?-->/g, ' ')
          .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
        const metas = [...html.matchAll(/<meta\b[^>]*>/gi)]
          .filter((m) =>
            ['robots', 'workroomprojecttool'].includes(attribute(m[0], 'name').toLowerCase()),
          )
          .map((m) => attribute(m[0], 'content'))
          .join(',');
        const directives = resource.robotsTag + ',' + metas;
        const noindex = /\b(?:noindex|none)\b/i.test(directives),
          nofollow = /\b(?:nofollow|none)\b/i.test(directives);
        if (noindex || /\bnoarchive\b/i.test(directives))
          network.forget(url.href, { accept: 'text/html,application/xhtml+xml' });
        if (!noindex) {
          const fullText = text(html),
            title = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || url.pathname);
          state.pages.push({
            url: resource.url || url.href,
            title,
            text: fullText.slice(0, maxTextChars),
            truncated: fullText.length > maxTextChars,
            originalCharacters: fullText.length,
            sha256: resource.sha256,
            fetchedAt: resource.fetchedAt,
            cacheHit: resource.cacheHit,
          });
        } else state.skipped.push({ url: url.href, reason: 'noindex' });
        state.seen.push(url.href);
        if (!nofollow && next.depth < maxDepth)
          for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
            if (/\bnofollow\b/i.test(attribute(match[0], 'rel'))) continue;
            const href = attribute(match[0], 'href');
            if (!href || /^(?:mailto|javascript|data|tel):/i.test(href)) continue;
            let linked;
            try {
              linked = new URL(href, resource.url || url);
            } catch {
              continue;
            }
            linked.hash = '';
            if (
              linked.origin !== origin.origin ||
              !linked.pathname.startsWith(prefix) ||
              linked.search ||
              linked.username ||
              linked.password ||
              state.seen.includes(linked.href) ||
              state.queue.some((item) => item.url === linked.href)
            )
              continue;
            if (state.queue.length >= 10000) {
              stopped =
                'Crawl queue limit 10,000 reached. Narrow the scope; saved pages remain indexed.';
              break;
            }
            state.queue.push({ url: linked.href, depth: next.depth + 1 });
          }
      } catch (error) {
        state.failures.push({
          url: url.href,
          message: error.message,
          code: error.code,
          retryAt: error.retryAt,
        });
        if (error.code !== 'HTTP_404') {
          state.processed--;
          state.queue.unshift(next);
          stopped = error.message;
          break;
        }
        state.seen.push(url.href);
      }
      save(root, checkpoint, state);
      if (stopped) break;
    }
  } catch (error) {
    stopped = error.message;
    state.failures.push({
      url: origin.href,
      message: error.message,
      code: error.code,
      retryAt: error.retryAt,
    });
  }
  save(root, checkpoint, state);
  save(root, indexPath, { version: 1, start: origin.href, documents: state.pages });
  return {
    indexed: state.pages.length,
    visited: state.processed,
    queued: state.queue.length,
    skipped: state.skipped.length,
    robotsMode,
    limitReached: !!state.queue.length && state.processed >= maxPages,
    stopped,
    checkpoint,
    indexPath,
    requests: network.requests,
  };
}
export function searchIndex({
  output = 'site-index',
  root = process.cwd(),
  query,
  limit = 5,
} = {}) {
  root = realpathSync(root);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error('Search limit must be 1–50.');
  const index = read(projectPath(root, join(output, 'search-index.json')), undefined);
  if (!index || !Array.isArray(index.documents)) throw new Error('No saved crawl index found.');
  const terms = [
    ...new Set(
      String(query || '')
        .toLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu) || [],
    ),
  ];
  if (!terms.length) return [];
  return index.documents
    .map((document) => {
      const lower = document.text.toLowerCase(),
        title = document.title.toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (lower.includes(term) ? 1 : 0) + (title.includes(term) ? 2 : 0),
        0,
      );
      const first = Math.max(
        0,
        lower.indexOf(terms.find((term) => lower.includes(term)) || '') - 100,
      );
      return {
        url: document.url,
        title: document.title,
        score,
        excerpt: document.text.slice(first, first + 700),
        fetchedAt: document.fetchedAt,
        truncated: document.truncated,
      };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help'))
    console.log(
      'Usage: node tools/workroom-crawl.mjs --start https://site/path/ --output site-index [--max-pages 25 --max-depth 2 --max-text-chars 100000 --robots ignore|respect --policy tools/network-policy.json]\nSearch locally: node tools/workroom-crawl.mjs --search "terms" --output site-index [--limit 5]\nPublic static HTML only. Robots default: ignore (configurable crawlRobots); respect mode checks robots.txt and crawl-delay. Both modes honor noindex/nofollow, same-origin path scope and network pacing/access policy. Query links are excluded. Limits: pages 1–1000 total across resumes, depth 0–10, text/page 1000–1000000 characters, queue 10000, search results 1–50. Checkpoints preserve work; no automatic blocked-host retries. Exit 2 means paused/partial work; inspect receipt, increase page allowance to continue a limited crawl.',
    );
  else
    try {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        if (
          ![
            '--start',
            '--search',
            '--output',
            '--max-pages',
            '--max-depth',
            '--max-text-chars',
            '--robots',
            '--policy',
            '--limit',
          ].includes(args[i]) ||
          !args[i + 1]
        )
          throw new Error('Unknown/incomplete option; use --help.');
        options[args[i]] = args[i + 1];
      }
      const root = realpathSync(process.cwd());
      if (options['--search'])
        console.log(
          JSON.stringify(
            searchIndex({
              root,
              output: options['--output'],
              query: options['--search'],
              limit: Number(options['--limit'] || 5),
            }),
            null,
            2,
          ),
        );
      else {
        if (!options['--start']) throw new Error('--start is required.');
        const policy = read(
          projectPath(root, options['--policy'] || 'tools/network-policy.json'),
          {},
        );
        const result = await crawlSite({
          root,
          policy,
          start: options['--start'],
          output: options['--output'],
          maxPages: Number(options['--max-pages'] || 25),
          maxDepth: Number(options['--max-depth'] || 2),
          maxTextChars: Number(options['--max-text-chars'] || 100000),
          robotsMode: options['--robots'] || policy.crawlRobots || 'ignore',
        });
        console.log(JSON.stringify(result, null, 2));
        if (result.stopped || result.limitReached) process.exitCode = 2;
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
