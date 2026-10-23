import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ThreadEvent, Codex } from '@openai/codex-sdk';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { consoleText, nativeConsole } from '../server/console.js';
import { codexGenerate, managedInfo } from '../server/managed.js';
import type { ConsoleEvent, ConsoleEntry } from '../shared/console.js';
import { CONSOLE_LIMITS } from '../shared/console.js';
import { defaultPolicy } from '../shared/schemas.js';
import { result } from './work-fixtures.js';

test('console redaction removes known credentials, common token forms, private keys and terminal escapes, and bounds excerpts', () => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fixture-key-never-in-console';
  try {
    const value = consoleText(
      'fixture-key-never-in-console\nAuthorization: Bearer token-that-must-not-appear\npassword="my-password"\napi_key=another-key\nsk-proj-1234567890123456789\n-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----\n\x1b[31mTests passed\x1b[0m',
    );
    for (const secret of [
      'fixture-key-never-in-console',
      'token-that-must-not-appear',
      'my-password',
      'another-key',
      'sk-proj-1234567890123456789',
      'private-key-body',
      '\x1b',
    ])
      assert.ok(!value.text.includes(secret));
    assert.match(value.text, /Tests passed/);
    const store = new Store(':memory:');
    try {
      store.putConsole({
        ...entry('metadata'),
        model: 'fixture-key-never-in-console',
        taskTitle: 'Inspect fixture-key-never-in-console',
      });
      assert.ok(
        !JSON.stringify(store.consoleEntries('project-a')).includes('fixture-key-never-in-console'),
      );
    } finally {
      store.close();
    }
    const long = consoleText(
      'Start of request\n' + 'large output '.repeat(10000) + '\nFinal failing assertion',
    );
    assert.equal(long.truncated, true);
    assert.ok(long.text.length <= 48000);
    assert.match(long.text, /Start of request/);
    assert.match(long.text, /Final failing assertion/);
    assert.match(long.text, /middle omitted/);
  } finally {
    if (before === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = before;
  }
});

const entry = (
  id: string,
  projectId = 'project-a',
  text = 'Actual tool output',
): Omit<ConsoleEntry, 'sequence' | 'createdAt' | 'updatedAt'> => ({
  id,
  projectId,
  type: 'command',
  phase: 'task',
  provider: 'codex',
  text,
});

test('console updates replace partial SDK items, survive restart, and remain separate from model state and portable backups', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-console-')),
    database = join(directory, 'test.sqlite');
  let store = new Store(database);
  try {
    const first = store.putConsole(entry('same-command', 'project-a', '$ node --test\nStarting'));
    const completed = store.putConsole({
      ...entry('same-command', 'project-a', '$ node --test\n2 passing\nExit code: 0'),
      status: 'completed',
    });
    assert.ok(completed.entry.sequence > first.entry.sequence);
    assert.equal(completed.entry.createdAt, first.entry.createdAt);
    assert.equal(store.consoleEntries('project-a').length, 1);
    store.putConsole(entry('other-project', 'project-b'));
    assert.equal(store.consoleEntries('project-a').length, 1);
    assert.ok(!JSON.stringify(store.backup()).includes('2 passing'));
    store.close();
    store = new Store(database);
    assert.match(store.consoleEntries('project-a')[0].text, /2 passing/);
    assert.equal('console' in store.state, false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('console history is bounded across long projects and across the workspace', () => {
  const store = new Store(':memory:');
  try {
    for (let i = 0; i < 310; i++) store.putConsole(entry(`short-${i}`));
    assert.equal(store.consoleEntries('project-a').length, 300);
    assert.equal(store.consoleEntries('project-a')[0].id, 'short-10');
    for (let p = 0; p < 6; p++)
      for (let i = 0; i < 160; i++)
        store.putConsole(entry(`long-${p}-${i}`, `project-${p}`, 'Tool output '.repeat(400)));
    let total = 0,
      count = 0;
    for (const id of ['project-a', ...Array.from({ length: 6 }, (_, i) => `project-${i}`)]) {
      const rows = store.consoleEntries(id);
      assert.ok(rows.length <= CONSOLE_LIMITS.projectEntries);
      const length = rows.reduce((n, e) => n + e.text.length, 0);
      assert.ok(length <= CONSOLE_LIMITS.projectCharacters);
      total += length;
      count += rows.length;
    }
    assert.ok(total <= CONSOLE_LIMITS.workspaceCharacters);
    assert.ok(count <= CONSOLE_LIMITS.workspaceEntries);
  } finally {
    store.close();
  }
});

test('native console reports observable activity, replies and command results while excluding reasoning text and coalescing rapid updates', () => {
  let time = 100;
  const events: ConsoleEvent[] = [],
    trace = nativeConsole(
      (e) => events.push(e),
      () => time,
    );
  trace({
    type: 'item.started',
    item: { id: 'thinking', type: 'reasoning', text: 'PRIVATE_REASONING_MUST_NOT_BE_FORWARDED' },
  });
  trace({
    type: 'item.completed',
    item: { id: 'thinking', type: 'reasoning', text: 'PRIVATE_REASONING_MUST_NOT_BE_FORWARDED' },
  });
  trace({
    type: 'item.started',
    item: {
      id: 'cmd',
      type: 'command_execution',
      command: 'node --test',
      aggregated_output: 'Starting',
      status: 'in_progress',
    },
  });
  time += 30;
  trace({
    type: 'item.updated',
    item: {
      id: 'cmd',
      type: 'command_execution',
      command: 'node --test',
      aggregated_output: 'Starting\nPartial',
      status: 'in_progress',
    },
  });
  trace({
    type: 'item.completed',
    item: {
      id: 'cmd',
      type: 'command_execution',
      command: 'node --test',
      aggregated_output: '2 passing',
      status: 'completed',
      exit_code: 0,
    },
  });
  trace({
    type: 'item.updated',
    item: {
      id: 'reply',
      type: 'agent_message',
      text: 'Public progress: inspected the implementation.',
    },
  });
  trace({
    type: 'item.completed',
    item: {
      id: 'reply',
      type: 'agent_message',
      text: 'Public result: implemented and ran node --test.',
    },
  });
  assert.equal(events.filter((e) => e.id === 'command:cmd').length, 2);
  assert.match(
    [...events].reverse().find((e) => e.type === 'command')!.text,
    /2 passing\nExit code: 0/,
  );
  assert.ok(events.some((e) => e.type === 'response' && /Public progress/.test(e.text)));
  assert.ok(!JSON.stringify(events).includes('PRIVATE_REASONING_MUST_NOT_BE_FORWARDED'));
  assert.equal(events.filter((e) => e.id === 'processing').length, 1);
});

test('the Codex document bridge forwards public events through the console hook without live inference', async () => {
  const ready = managedInfo.codexReady;
  managedInfo.codexReady = true;
  const events: ConsoleEvent[] = [];
  try {
    const factory = (): Pick<Codex, 'startThread'> => ({
      startThread() {
        return {
          async runStreamed() {
            return {
              events: (async function* (): AsyncGenerator<ThreadEvent> {
                yield {
                  type: 'item.started',
                  item: { id: 'reason', type: 'reasoning', text: 'PRIVATE_SDK_TEXT' },
                };
                yield {
                  type: 'item.updated',
                  item: { id: 'answer', type: 'agent_message', text: 'Visible draft reply' },
                };
                yield {
                  type: 'item.completed',
                  item: { id: 'answer', type: 'agent_message', text: 'Visible complete reply' },
                };
                yield {
                  type: 'turn.completed',
                  usage: {
                    input_tokens: 10,
                    output_tokens: 20,
                    cached_input_tokens: 0,
                    cache_write_input_tokens: 0,
                    reasoning_output_tokens: 0,
                  },
                };
              })(),
            };
          },
        } as unknown as ReturnType<Codex['startThread']>;
      },
    });
    const output = await codexGenerate(
      'Workroom instructions',
      '{}',
      'fixture-model',
      undefined,
      false,
      factory,
      'medium',
      undefined,
      (e) => events.push(e),
    );
    assert.equal(output.text, 'Visible complete reply');
    assert.ok(events.some((e) => e.text === 'Visible draft reply'));
    assert.ok(!JSON.stringify(events).includes('PRIVATE_SDK_TEXT'));
  } finally {
    managedInfo.codexReady = ready;
  }
});

test('console observation makes no extra model calls, records scoped redacted requests/results, and cannot break task execution', async () => {
  const fetch = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fixture-credential-hidden';
  const store = new Store(':memory:'),
    engine = new Engine(store, 1);
  try {
    store.state.provider = 'openai';
    store.state.policy = {
      ...structuredClone(defaultPolicy),
      allowPaid: true,
      rates: {
        openai: {
          model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
          inputPerMillion: 0,
          outputPerMillion: 0,
        },
      },
    };
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({
        choices: [{ message: { content: JSON.stringify(result()) } }],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      });
    }) as typeof fetch;
    const project = await engine.createProject(
      'Visible actual work',
      'Compare supplied figures with a useful result. A supplied secret is fixture-credential-hidden.',
      'office',
      'template',
      undefined,
      'custom',
    );
    engine.start();
    engine.runProject(project.id);
    for (let i = 0; i < 100 && project.status !== 'completed'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(project.status, 'completed');
    assert.equal(calls, 1);
    const rows = store.consoleEntries(project.id);
    assert.ok(rows.some((e) => e.type === 'request' && e.taskId && e.agentId && e.attemptId));
    assert.ok(
      rows.some((e) => e.type === 'response' && e.text.includes(result().deliverable.slice(0, 12))),
    );
    assert.ok(!JSON.stringify(rows).includes('fixture-credential-hidden'));
    const next = await engine.createProject(
      'Logging failure is isolated',
      'Compare supplied office costs and provide a useful checked result.',
      'office',
      'template',
      undefined,
      'custom',
    );
    let warnings = 0;
    engine.on('console_warning', () => warnings++);
    store.putConsole = () => {
      throw new Error('Console write failed');
    };
    engine.runProject(next.id);
    for (let i = 0; i < 100 && next.status !== 'completed'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(next.status, 'completed');
    assert.equal(calls, 2);
    assert.ok(warnings > 0);
  } finally {
    engine.stop();
    store.close();
    globalThis.fetch = fetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});
