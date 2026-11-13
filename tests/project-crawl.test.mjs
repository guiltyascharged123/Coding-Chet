import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectNetwork } from '../project-tools/network.mjs';
import {
  crawlSite,
  searchIndex,
  robotsRules,
  robotsAllows,
} from '../project-tools/workroom-crawl.mjs';

function harness(pages, policy = {}) {
  const root = mkdtempSync(join(tmpdir(), 'workroom-crawl-')),
    requests = [];
  let time = 1800000000000;
  const client = new ProjectNetwork({
    directory: join(root, '.workroom-http'),
    policy,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, at: time, init });
      const value = pages[new URL(url).pathname];
      return value instanceof Response
        ? value
        : value === undefined
          ? new Response('Missing', { status: 404 })
          : new Response(value, {
              headers: { 'Content-Type': url.endsWith('robots.txt') ? 'text/plain' : 'text/html' },
            });
    },
  });
  return { root, requests, client, close: () => rmSync(root, { recursive: true, force: true }) };
}
test('robots respect mode uses the applicable group, longest path and allow tie breaks', () => {
  const policy = robotsRules(
    'User-agent: *\nDisallow: /\nUser-agent: WorkroomProjectTool\nDisallow: /private/\nAllow: /private/public$\nCrawl-delay: 2',
  );
  assert.equal(robotsAllows(policy, 'https://site.example/public'), true);
  assert.equal(robotsAllows(policy, 'https://site.example/private/item'), false);
  assert.equal(robotsAllows(policy, 'https://site.example/private/public'), true);
  assert.equal(robotsAllows(policy, 'https://site.example/private/public/more'), false);
  assert.equal(policy.delayMs, 2000);
});
test('crawler indexes real HTML, skips out-of-scope/nofollow/query links, enforces robots when selected, and searches locally', async () => {
  const h = harness({
    '/robots.txt': 'User-agent: *\nDisallow: /docs/private\nCrawl-delay: 2',
    '/docs/':
      '<title>Widget guide</title><script>FAKE HIDDEN TEXT</script><h1>Real widget prices</h1><a href="next">next</a><a href="private">private</a><a href="hidden">hidden</a><a rel="nofollow" href="never">nofollow</a><a href="?page=3">query</a><a href="/outside">outside</a><a href="https://other.example/docs/">external</a>',
    '/docs/next': '<title>Pricing</title>Widgets cost $25. <a href="last">last</a>',
    '/docs/last': '<title>Last</title>Verified specifications',
    '/docs/hidden':
      '<meta name="robots" content="noindex,nofollow">Hidden text <a href="never">no follow</a>',
  });
  try {
    const result = await crawlSite({
      root: h.root,
      start: 'https://site.example/docs/',
      client: h.client,
      robotsMode: 'respect',
    });
    assert.equal(result.indexed, 3);
    assert.equal(result.skipped, 2);
    assert.equal(result.stopped, undefined);
    assert.equal(
      h.requests.some((request) => /private|never|outside|other\.example|\?/.test(request.url)),
      false,
    );
    for (let i = 1; i < h.requests.length; i++)
      assert.ok(h.requests[i].at - h.requests[i - 1].at >= 2000);
    const count = h.requests.length,
      found = searchIndex({ root: h.root, query: 'widget pricing' });
    assert.equal(found[0].title, 'Pricing');
    assert.match(found[0].excerpt, /\$25/);
    assert.equal(h.requests.length, count, 'search sends no network traffic');
    const index = readFileSync(result.indexPath, 'utf8');
    assert.ok(!index.includes('FAKE HIDDEN TEXT') && !index.includes('Hidden text'));
    const again = await crawlSite({
      root: h.root,
      start: 'https://site.example/docs/',
      client: h.client,
      robotsMode: 'respect',
    });
    assert.equal(again.indexed, 3);
    assert.equal(h.requests.length, count, 'completed crawl reuses saved work');
  } finally {
    h.close();
  }
});
test('ignore robots mode is explicit in receipts, skips robots fetch and retains rate limits/checkpoint resume', async () => {
  const h = harness({
    '/docs/': '<title>Start</title>Useful data <a href="next">next</a>',
    '/docs/next': '<title>Second</title>More useful data',
  });
  try {
    const first = await crawlSite({
      root: h.root,
      start: 'https://site.example/docs/',
      client: h.client,
      maxPages: 1,
    });
    assert.equal(first.robotsMode, 'ignore');
    assert.equal(first.indexed, 1);
    assert.equal(first.limitReached, true);
    assert.equal(first.queued, 1);
    const second = await crawlSite({
      root: h.root,
      start: 'https://site.example/docs/',
      client: h.client,
      maxPages: 2,
    });
    assert.equal(second.indexed, 2);
    assert.equal(second.limitReached, false);
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests[1].at - h.requests[0].at >= 1000);
    await assert.rejects(
      crawlSite({
        root: h.root,
        start: 'https://site.example/docs/',
        client: h.client,
        robotsMode: 'respect',
      }),
      /robots setting/,
    );
  } finally {
    h.close();
  }
});
test('crawl scope is enforced before following redirects; 403 pauses rather than repeatedly fetching', async () => {
  const h = harness({
    '/docs/': '<a href="redirect">go</a>',
    '/docs/redirect': new Response(null, {
      status: 302,
      headers: { Location: 'https://other.example/data' },
    }),
  });
  try {
    const result = await crawlSite({
      root: h.root,
      start: 'https://site.example/docs/',
      client: h.client,
    });
    assert.match(result.stopped, /Redirect rejected/);
    assert.equal(result.indexed, 1);
    assert.equal(result.queued, 1);
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every((request) => new URL(request.url).hostname === 'site.example'));
  } finally {
    h.close();
  }
  const blocked = harness({ '/docs/': new Response('Forbidden', { status: 403 }) });
  try {
    const result = await crawlSite({
      root: blocked.root,
      start: 'https://site.example/docs/',
      client: blocked.client,
    });
    assert.match(result.stopped, /HTTP 403/);
    assert.equal(result.queued, 1);
    await crawlSite({
      root: blocked.root,
      start: 'https://site.example/docs/',
      client: blocked.client,
    });
    assert.equal(blocked.requests.length, 1, 'persisted pause prevents repeat requests');
  } finally {
    blocked.close();
  }
});
