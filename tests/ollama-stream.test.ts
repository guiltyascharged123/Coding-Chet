import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localGenerate, localContextTokens } from '../server/managed.js';
import type { ConsoleEvent } from '../shared/console.js';

test('Ollama streams public text across Unicode chunk boundaries, preserves one reply and returns completion metrics', async () => {
  const oldFetch = globalThis.fetch,
    events: ConsoleEvent[] = [];
  try {
    const encoded = new TextEncoder().encode(
      [
        JSON.stringify({
          message: { thinking: 'PRIVATE-THINKING', content: 'Public 🧠 ' },
          done: false,
        }),
        JSON.stringify({ message: { content: 'reply.' }, done: false }),
        JSON.stringify({ done: true, prompt_eval_count: 66, eval_count: 12, done_reason: 'stop' }),
      ].join('\n') + '\n',
    );
    const split = encoded.indexOf(0xf0) + 2;
    globalThis.fetch = (async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.stream, true);
      assert.equal(body.think, false);
      assert.ok(body.options.num_ctx >= 8192);
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoded.slice(0, split));
            controller.enqueue(encoded.slice(split));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } },
      );
    }) as typeof fetch;
    const response = await localGenerate(
      'System',
      'Assignment',
      'offline-model',
      500,
      undefined,
      false,
      undefined,
      { onTrace: (event) => events.push(event) },
    );
    assert.deepEqual(response, { text: 'Public 🧠 reply.', inputTokens: 66, outputTokens: 12 });
    assert.ok(events.some((event) => event.status === 'in_progress'));
    assert.equal(events.at(-1)!.status, 'completed');
    assert.ok(
      events.every((event) => event.id === 'result' && !event.text.includes('PRIVATE-THINKING')),
    );
    assert.ok(localContextTokens('x'.repeat(20000), 'x'.repeat(4000), 2000) > 8192);
    assert.equal(localContextTokens('x'.repeat(200000), '', 16000), 32768);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('an incomplete local stream remains a partial reply and does not manufacture a completion receipt or retry', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  const events: ConsoleEvent[] = [];
  try {
    for (const format of ['application/x-ndjson', 'application/json']) {
      globalThis.fetch = (async () => {
        calls++;
        return new Response(
          JSON.stringify({ message: { content: 'Partial public reply' }, done: false }) + '\n',
          { headers: { 'Content-Type': format } },
        );
      }) as typeof fetch;
      await assert.rejects(
        () =>
          localGenerate('System', 'Assignment', 'offline', 500, undefined, false, undefined, {
            onTrace: (event) => events.push(event),
          }),
        /completion receipt/,
      );
    }
    assert.equal(calls, 2);
    assert.equal(events[0].text, 'Partial public reply');
    assert.ok(!events.some((event) => event.status === 'completed'));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('local model timeout is actionable and remains distinct from explicit cancellation', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((_url, options) =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fixture took too long')), 300);
        const signal = options!.signal!;
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      })) as typeof fetch;
    await assert.rejects(
      () =>
        localGenerate('System', 'Assignment', 'offline', 500, undefined, false, undefined, {
          timeoutSeconds: 0.01,
        }),
      /Ollama reached.*request timeout/,
    );
    const controller = new AbortController();
    const pending = localGenerate('System', 'Assignment', 'offline', 500, controller.signal);
    controller.abort();
    await assert.rejects(() => pending, /Ollama work was cancelled/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('a broken stream flushes the latest public text even inside the update throttle window', async () => {
  const oldFetch = globalThis.fetch,
    events: ConsoleEvent[] = [];
  try {
    let pulls = 0;
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (pulls++ === 0)
              controller.enqueue(
                new TextEncoder().encode(
                  [
                    JSON.stringify({ message: { content: 'First public words. ' }, done: false }),
                    JSON.stringify({
                      message: { content: 'Latest words before disconnect.', thinking: 'PRIVATE' },
                      done: false,
                    }),
                  ].join('\n') + '\n',
                ),
              );
            else controller.error(new Error('Fixture stream disconnected'));
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson' } },
      )) as typeof fetch;
    await assert.rejects(
      () =>
        localGenerate('System', 'Assignment', 'offline', 500, undefined, false, undefined, {
          onTrace: (event) => events.push(event),
        }),
      /stream disconnected/,
    );
    assert.equal(events.at(-1)?.text, 'First public words. Latest words before disconnect.');
    assert.equal(events.at(-1)?.status, 'interrupted');
    assert.ok(
      events.every((event) => !event.text.includes('PRIVATE') && event.status !== 'completed'),
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});
