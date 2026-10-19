import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import type { Codex, ThreadEvent } from '@openai/codex-sdk';
import {
  codexEnvironment,
  codexWorkerOptions,
  codexGenerate,
  localGenerate,
  refreshManagedInfo,
  managedInfo,
  apiDiagnostics,
  serviceUrl,
} from '../server/managed.js';

test('service URLs restrict local billing to loopback and reject insecure remote credentials', () => {
  assert.equal(serviceUrl('http://127.0.0.1:11434', true).protocol, 'http:');
  assert.equal(serviceUrl('https://model.example/v1').pathname, '/v1');
  for (const url of [
    'http://model.example/v1',
    'https://key@model.example/v1',
    'file://localhost/tmp',
    'https://model.example/v1?key=secret',
  ])
    assert.throws(() => serviceUrl(url));
  assert.throws(() => serviceUrl('https://model.example/v1', true));
});

test('connection checks inspect installed model metadata, and local generation has bounded options', async () => {
  const fetch = globalThis.fetch,
    env = { ...process.env };
  try {
    delete process.env.WORKROOM_CODEX_ENABLED;
    process.env.OLLAMA_MODEL = 'local-test:3b';
    process.env.COMPATIBLE_API_URL = 'http://127.0.0.1:1234/v1';
    process.env.COMPATIBLE_MODEL = 'compatible-test';
    process.env.COMPATIBLE_BILLING = 'local';
    process.env.OPENAI_API_KEY = 'test-only';
    delete process.env.GEMINI_API_KEY;
    const calls: string[] = [];
    globalThis.fetch = (async (url, options) => {
      calls.push(String(url));
      if (String(url).endsWith('/api/tags'))
        return Response.json({ models: [{ name: 'local-test:3b' }] });
      if (String(url).endsWith('/models'))
        return Response.json({ data: [{ id: 'compatible-test' }] });
      if (String(url).includes('api.openai.com')) {
        assert.equal(options?.method, undefined);
        return Response.json({ id: 'gpt-4.1-mini' });
      }
      const body = JSON.parse(String(options?.body));
      assert.equal(body.options.num_predict, 500);
      assert.equal(body.stream, false);
      assert.equal(body.model, 'local-test:3b');
      return Response.json({
        message: { content: '# Local document' },
        prompt_eval_count: 50,
        eval_count: 10,
      });
    }) as typeof fetch;
    await refreshManagedInfo(true);
    assert.equal(managedInfo.ollamaReady, true);
    assert.equal(managedInfo.compatibleReady, true);
    assert.equal(managedInfo.codexReady, false);
    assert.match(apiDiagnostics.openai!, /metadata responded/);
    assert.ok(!calls.some((url) => url.includes('chat/completions')));
    assert.deepEqual(await localGenerate('system', 'assignment', 'local-test:3b', 500), {
      text: '# Local document',
      inputTokens: 50,
      outputTokens: 10,
    });
    process.env.OLLAMA_MODEL = 'missing-model';
    await refreshManagedInfo();
    assert.equal(managedInfo.ollamaReady, false);
  } finally {
    globalThis.fetch = fetch;
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});

test('Codex uses isolated document instructions, excludes API secrets, and requires a completed receipt', async () => {
  const before = managedInfo.codexReady;
  managedInfo.codexReady = true;
  const env = codexEnvironment();
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(codexWorkerOptions('/temporary-document').config?.forced_login_method, 'chatgpt');
  assert.match(
    codexWorkerOptions('C:\\Temp\\document').configOverrides![0],
    /"C:\\\\Temp\\\\document" = "read"/,
  );
  let directory = '';
  function factory(events: ThreadEvent[]): Pick<Codex, 'startThread'> {
    return {
      startThread(options) {
        directory = options!.workingDirectory!;
        assert.ok(existsSync(directory));
        assert.equal(options?.approvalPolicy, 'untrusted');
        assert.equal(options?.networkAccessEnabled, undefined);
        return {
          async runStreamed(prompt: string) {
            assert.match(prompt, /Do not use tools/);
            return {
              events: (async function* () {
                for (const e of events) yield e;
              })(),
            };
          },
        } as ReturnType<Codex['startThread']>;
      },
    };
  }
  const message: ThreadEvent = {
    type: 'item.completed',
    item: { id: 'document', type: 'agent_message', text: '# Actual result' },
  };
  const receipt: ThreadEvent = {
    type: 'turn.completed',
    usage: {
      input_tokens: 50,
      output_tokens: 10,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      reasoning_output_tokens: 0,
    },
  };
  try {
    const result = await codexGenerate(
      'system',
      'assignment',
      'Codex account default',
      undefined,
      false,
      () => factory([message, receipt]),
    );
    assert.equal(result.text, '# Actual result');
    assert.equal(result.inputTokens, 50);
    assert.equal(existsSync(directory), false);
    await assert.rejects(
      () =>
        codexGenerate('system', 'assignment', 'Codex account default', undefined, false, () =>
          factory([message]),
        ),
      /without a completion receipt/,
    );
    const command: ThreadEvent = {
      type: 'item.started',
      item: {
        id: 'command',
        type: 'command_execution',
        command: 'rejected',
        aggregated_output: '',
        status: 'in_progress',
      },
    };
    await assert.rejects(
      () =>
        codexGenerate('system', 'assignment', 'Codex account default', undefined, false, () =>
          factory([command]),
        ),
      /requested a tool/,
    );
    assert.equal(existsSync(directory), false);
    managedInfo.codexReady = false;
    await assert.rejects(
      () => codexGenerate('system', 'assignment', 'default'),
      /authentication has not been verified/,
    );
  } finally {
    managedInfo.codexReady = before;
  }
});
