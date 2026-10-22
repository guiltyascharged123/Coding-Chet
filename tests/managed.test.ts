import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Codex, ThreadEvent } from '@openai/codex-sdk';
import {
  codexEnvironment,
  codexWorkerOptions,
  codexThreadOptions,
  codexGenerate,
  localGenerate,
  refreshManagedInfo,
  managedInfo,
  apiDiagnostics,
  serviceUrl,
} from '../server/managed.js';
import { codexFailure, CodexWorkerError } from '../server/codex-errors.js';

test('the bundled native CLI accepts the complete document worker configuration without inference', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-native-config-'));
  const testCodexHome = join(directory, 'cli-state');
  mkdirSync(testCodexHome, { mode: 0o700 });
  try {
    const worker = codexWorkerOptions(directory),
      thread = codexThreadOptions(directory, 'gpt-6.1-sol');
    assert.equal(thread.approvalPolicy, 'never');
    assert.equal(worker.config?.project_doc_max_bytes, 0);
    assert.equal(worker.config?.include_skill_instructions, false);
    assert.match(worker.configOverrides![0], /":root" = "deny"/);
    const config = {
      ...worker.config,
      approval_policy: thread.approvalPolicy,
      model: thread.model,
      web_search: thread.webSearchMode,
      model_reasoning_effort: thread.modelReasoningEffort,
      cli_auth_credentials_store: 'ephemeral',
    };
    function flatten(value: Record<string, unknown>, prefix = ''): string[] {
      return Object.entries(value).flatMap(([key, item]) => {
        if (item === undefined) return [];
        const path = prefix ? `${prefix}.${key}` : key;
        if (item && typeof item === 'object' && !Array.isArray(item))
          return Object.keys(item).length
            ? flatten(item as Record<string, unknown>, path)
            : [`${path}={}`];
        return [`${path}=${JSON.stringify(item)}`];
      });
    }
    const entry = createRequire(import.meta.resolve('@openai/codex-sdk')).resolve(
      '@openai/codex/bin/codex.js',
    );
    const result = spawnSync(
      process.execPath,
      [
        entry,
        'debug',
        'prompt-input',
        'Workroom offline configuration regression.',
        ...flatten(config)
          .concat(worker.configOverrides || [])
          .flatMap((c) => ['--config', c]),
      ],
      {
        cwd: directory,
        // Private CLI state for this child only. No existing login is read or used.
        env: { ...codexEnvironment(), CODEX_HOME: testCodexHome },
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(
      result.status,
      0,
      'The native CLI must accept the restricted configuration without requiring login or generation.',
    );
    assert.ok(
      JSON.stringify(JSON.parse(result.stdout)).includes(
        'Workroom offline configuration regression.',
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Codex failures expose actionable categories without raw responses, credentials, or project text', () => {
  const cases: [string, string][] = [
    [
      'Error: approval_policy = "untrusted" is no longer supported; remove this setting',
      'CODEX_CONFIG',
    ],
    ["The 'example' model is not supported when using Codex with a ChatGPT account", 'CODEX_MODEL'],
    ['Unsupported value for reasoning effort: low is not supported', 'CODEX_REASONING'],
    ['HTTP 401 refresh_token_expired', 'CODEX_AUTH'],
    ['You have hit your usage limit. HTTP 429', 'CODEX_QUOTA'],
    [
      'error building bubblewrap command: app-server socket directory must be user-owned',
      'CODEX_SANDBOX',
    ],
    ['error sending request: certificate verification failed', 'CODEX_NETWORK'],
    ['spawn codex ENOENT', 'CODEX_INSTALL'],
    ['Codex could not finish. Unrecognized provider response', 'CODEX_UNKNOWN'],
  ];
  for (const [message, code] of cases) {
    const failure = codexFailure(new Error(message + ' sk-test-not-real private-project-brief'));
    assert.equal(failure.code, code);
    assert.doesNotMatch(failure.message, /sk-test-not-real|private-project-brief/);
    assert.match(failure.message, /No API fallback/);
  }
  const known = new CodexWorkerError('CODEX_TOOL_BLOCKED');
  assert.equal(codexFailure(known), known);
});

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
        assert.equal(options?.approvalPolicy, 'never');
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
        codexGenerate('system', 'assignment', 'gpt-6.1-sol', undefined, false, () =>
          factory([
            {
              type: 'turn.failed',
              error: {
                message:
                  'The selected model is not supported when using Codex with a ChatGPT account. sk-test-not-real',
              },
            },
          ]),
        ),
      (error: unknown) =>
        error instanceof CodexWorkerError &&
        error.code === 'CODEX_MODEL' &&
        !error.message.includes('sk-test-not-real'),
    );
    await assert.rejects(
      () =>
        codexGenerate('system', 'assignment', 'gpt-6.1-sol', undefined, false, () =>
          factory([{ type: 'error', message: 'HTTP 401 invalid_grant sk-test-not-real' }]),
        ),
      (error: unknown) =>
        error instanceof CodexWorkerError &&
        error.code === 'CODEX_AUTH' &&
        !error.message.includes('sk-test-not-real'),
    );
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
