import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectNetwork } from '../project-tools/network.mjs';
import { downloadImages } from '../project-tools/workroom-download.mjs';

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'workroom-network-'));
  let clock = 1800000000000;
  const events = [],
    requests = [];
  const settings = {
    directory: join(root, '.http'),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    onEvent: (event) => events.push(event),
    ...options,
    fetchImpl: async (url, init) => {
      requests.push({ url, init, at: clock });
      return options.reply
        ? options.reply(url, init, clock)
        : new Response('data', { headers: { ETag: 'v1' } });
    },
  };
  return {
    root,
    settings,
    requests,
    events,
    client: new ProjectNetwork(settings),
    advance: (ms) => {
      clock += ms;
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
test('URL normalization shares host pauses and partial stream failures are not cached or repeatedly fetched', async () => {
  const h = fixture({
    reply: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'));
            controller.error(new Error('connection ended'));
          },
        }),
      ),
  });
  try {
    await assert.rejects(h.client.get('https://site.example./data'), { code: 'TRANSPORT_ERROR' });
    await assert.rejects(h.client.get('https://SITE.example/data'), { code: 'HOST_PAUSED' });
    assert.equal(h.requests.length, 1);
    assert.equal(new URL(h.requests[0].url).hostname, 'site.example');
    await assert.rejects(h.client.get('https://localhost./private'), { code: 'URL_POLICY' });
    assert.equal(h.requests.length, 1);
  } finally {
    h.close();
  }
});
test('project network serializes calls, paces hosts and reuses fresh cached bytes without another request', async () => {
  const h = fixture();
  try {
    const [a, b] = await Promise.all([
      h.client.get('https://images.example/a'),
      h.client.get('https://images.example/b'),
    ]);
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests[1].at - h.requests[0].at >= 1000);
    assert.equal(a.bytes.toString(), 'data');
    assert.equal(b.bytes.toString(), 'data');
    const cached = await h.client.get('https://images.example/a');
    assert.equal(cached.cacheHit, true);
    assert.equal(h.requests.length, 2);
    assert.ok(h.events.some((event) => event.type === 'paced'));
  } finally {
    h.close();
  }
});
test('stale cache uses validators and honors 304; cache-control no-cache requires revalidation', async () => {
  const h = fixture({
    reply: (_url, init) =>
      init.headers['If-None-Match']
        ? new Response(null, { status: 304 })
        : new Response('verified', { headers: { ETag: 'stable', 'Cache-Control': 'no-cache' } }),
  });
  try {
    await h.client.get('https://data.example/a');
    const cached = await h.client.get('https://data.example/a');
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[1].init.headers['If-None-Match'], 'stable');
    assert.equal(cached.bytes.toString(), 'verified');
    assert.equal(cached.cacheHit, true);
    await h.client.get('https://data.example/a');
    assert.equal(h.requests.length, 3, 'no-cache remains in force after a 304');
  } finally {
    h.close();
  }
});

test('separate clients cannot race the shared project pacing state or send parallel requests', async () => {
  let enter, release;
  const started = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = fixture({
    reply: async () => {
      enter();
      await gate;
      return new Response('checked');
    },
  });
  try {
    const first = h.client.get('https://site.example/a');
    await started;
    await assert.rejects(
      () => new ProjectNetwork(h.settings).get('https://site.example/b'),
      (error) => error.code === 'NETWORK_BUSY',
    );
    assert.equal(h.requests.length, 1);
    release();
    await first;
    assert.ok(!readdirSync(join(h.root, '.http')).includes('request.lock'));
  } finally {
    release();
    h.close();
  }
});
test('remaining/reset feedback prevents the next network request and survives a new client', async () => {
  const h = fixture({
    reply: (_url, _init, clock) =>
      new Response('last permitted result', {
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(clock / 1000 + 60) },
      }),
  });
  try {
    await h.client.get('https://api.example/a');
    await assert.rejects(() => h.client.get('https://api.example/b'), /zero remaining requests/);
    const resumed = new ProjectNetwork(h.settings);
    await assert.rejects(() => resumed.get('https://api.example/c'), /No request was sent/);
    assert.equal(h.requests.length, 1);
  } finally {
    h.close();
  }
});
test('403 and 429 pause hosts without retry storms, using Retry-After when supplied', async () => {
  for (const status of [403, 429]) {
    const h = fixture({
      reply: () => new Response(null, { status, headers: { 'Retry-After': '120' } }),
    });
    try {
      await assert.rejects(
        () => h.client.get('https://site.example/a'),
        (error) => error.code === `HTTP_${status}` && error.retryAt === 1800000120000,
      );
      await assert.rejects(
        () => new ProjectNetwork(h.settings).get('https://site.example/b'),
        /paused/,
      );
      assert.equal(h.requests.length, 1);
    } finally {
      h.close();
    }
  }
});
test('policy can prevent direct requests entirely in favor of an official API or permitted cached source', async () => {
  const h = fixture({
    policy: {
      hosts: { 'site.example': { access: 'api-only', preferredSources: ['https://api.example/'] } },
    },
  });
  try {
    await assert.rejects(() => h.client.get('https://site.example/a'), /https:\/\/api.example/);
    assert.equal(h.requests.length, 0);
    for (const url of [
      'http://site.example/a',
      'file:///etc/passwd',
      'https://localhost/a',
      'https://127.0.0.1/a',
      'https://user:pass@site.example/a',
    ])
      await assert.rejects(() => h.client.get(url), /public HTTPS/);
    assert.equal(h.requests.length, 0);
  } finally {
    h.close();
  }
});
test('budgets include redirects and oversized responses are not cached as successful results', async () => {
  const redirect = fixture({
    policy: { maxRequests: 1 },
    reply: () => new Response(null, { status: 302, headers: { Location: '/next' } }),
  });
  try {
    await assert.rejects(() => redirect.client.get('https://site.example/a'), /budget 1 reached/);
    assert.equal(redirect.requests.length, 1);
  } finally {
    redirect.close();
  }
  const large = fixture({ policy: { maxBytes: 3 } });
  try {
    await assert.rejects(() => large.client.get('https://site.example/a'), /maxBytes 3/);
    assert.deepEqual(readdirSync(join(large.root, '.http')), ['hosts.json']);
  } finally {
    large.close();
  }
});
test('image downloads produce real files, preserve completed work on a block, and skip checked files on resume', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const h = fixture({
    reply: (url) =>
      url.endsWith('/blocked')
        ? new Response(null, { status: 403 })
        : new Response(png, { headers: { 'Content-Type': 'image/png' } }),
  });
  const urls = [
    'https://images.example/one',
    'https://images.example/two',
    'https://images.example/blocked',
    'https://images.example/not-requested',
  ];
  try {
    const first = await downloadImages({ urls, output: 'images', root: h.root, client: h.client });
    assert.equal(first.completed, 2);
    assert.equal(first.failed, 1);
    assert.match(first.stopped, /403/);
    const index = JSON.parse(readFileSync(first.indexPath, 'utf8'));
    assert.equal(index.files.length, 2);
    for (const file of index.files)
      assert.deepEqual(readFileSync(join(h.root, 'images', file.filename)), png);
    assert.equal(h.requests.length, 3);
    const resumed = await downloadImages({
      urls,
      output: 'images',
      root: h.root,
      client: new ProjectNetwork(h.settings),
    });
    assert.equal(resumed.skipped, 2);
    assert.equal(resumed.completed, 0);
    assert.equal(h.requests.length, 3);
    await assert.rejects(
      () => downloadImages({ urls, output: '../escape', root: h.root, client: h.client }),
      /inside the project/,
    );
  } finally {
    h.close();
  }
});
