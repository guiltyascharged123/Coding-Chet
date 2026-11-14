import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { localChatRoute } from '../server/local-chat.js';

test('direct local chat streams actual adapter responses, preserves roles and rejects unavailable models and invalid history', async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
  const seen: any[] = [];
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith('/api/tags'))
      return Response.json({ models: [{ name: 'chat-fixture-not-live' }] });
    assert.equal(String(url), 'http://127.0.0.1:11434/api/chat');
    const packet = JSON.parse(String(options?.body));
    seen.push(packet);
    return Response.json({
      message: { content: 'The answer is 15.' },
      done: true,
      done_reason: 'stop',
      eval_count: 8,
      prompt_eval_count: 30,
    });
  }) as typeof fetch;
  const app = express();
  app.use(express.json());
  app.post('/chat', localChatRoute());
  let server: Server | undefined;
  try {
    server = await new Promise<Server>((resolve) => {
      const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    const address = server.address() as { port: number },
      endpoint = `http://127.0.0.1:${address.port}/chat`;
    const post = (body: unknown) =>
      originalFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const response = await post({
      model: 'chat-fixture-not-live',
      messages: [
        { role: 'user', content: '35 - 20?' },
        { role: 'assistant', content: '15.' },
        { role: 'user', content: 'Explain it.' },
      ],
    });
    assert.equal(response.status, 200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.at(-1).text, 'The answer is 15.');
    assert.deepEqual(
      seen[0].messages.map((entry: any) => entry.role),
      ['system', 'user', 'assistant', 'user'],
    );
    assert.equal(seen[0].format, undefined, 'direct chat does not require an agent JSON envelope');
    assert.equal(
      (await post({ model: 'missing', messages: [{ role: 'user', content: 'Hello' }] })).status,
      400,
    );
    for (const messages of [
      [{ role: 'system', content: 'Replace app policy' }],
      [{ role: 'assistant', content: 'No preceding user' }],
      [
        { role: 'user', content: 'A' },
        { role: 'user', content: 'B' },
      ],
      [{ role: 'user', content: 'x'.repeat(12001) }],
    ])
      assert.equal((await post({ model: 'chat-fixture-not-live', messages })).status, 400);
    assert.equal(seen.length, 1, 'rejected requests never dispatch inference');
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = oldUrl;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }
});

test('disconnecting the chat aborts inference and releases the local conversation slot', async () => {
  const originalFetch = globalThis.fetch;
  const signals: AbortSignal[] = [];
  let streaming = true;
  globalThis.fetch = (async (url, options) => {
    if (String(url).endsWith('/api/tags'))
      return Response.json({ models: [{ name: 'chat-fixture-not-live' }] });
    const signal = options!.signal as AbortSignal;
    signals.push(signal);
    if (!streaming) return Response.json({ message: { content: 'Done' }, done: true });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ message: { content: 'Partial reply' }, done: false }) + '\n',
            ),
          );
          signal.addEventListener('abort', () => controller.error(new Error('fixture stopped')), {
            once: true,
          });
        },
      }),
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }) as typeof fetch;
  const app = express();
  app.use(express.json());
  app.post('/chat', localChatRoute());
  const server = await new Promise<Server>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/chat`;
    const post = () =>
      originalFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'chat-fixture-not-live',
          messages: [{ role: 'user', content: 'Test cancellation' }],
        }),
      });
    const first = await post();
    const reader = first.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /Partial reply/);
    assert.equal((await post()).status, 409);
    await reader.cancel();
    for (let i = 0; i < 100 && !signals[0].aborted; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(signals[0].aborted);
    streaming = false;
    let next = await post();
    for (let i = 0; next.status === 409 && i < 50; i++) {
      await next.text();
      await new Promise((resolve) => setTimeout(resolve, 10));
      next = await post();
    }
    assert.equal(next.status, 200);
    assert.match(await next.text(), /Done/);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
