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
  codexWork,
  codexCodingOptions,
  codexConfigArgs,
  checkCodingSandbox,
  localGenerate,
  refreshManagedInfo,
  managedInfo,
  apiDiagnostics,
  serviceUrl,
} from '../server/managed.js';
import { codexFailure, CodexWorkerError } from '../server/codex-errors.js';
import { result } from './work-fixtures.js';
import type { ConsoleEvent } from '../shared/console.js';

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

test('the native CLI accepts writable and inspection coding profiles without inference', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-coding-config-'));
  const testCodexHome = join(directory, 'cli-state');
  mkdirSync(testCodexHome, { mode: 0o700 });
  try {
    const entry = createRequire(import.meta.resolve('@openai/codex-sdk')).resolve(
      '@openai/codex/bin/codex.js',
    );
    for (const readOnly of [false, true]) {
      const options = codexCodingOptions(directory, false, readOnly);
      assert.equal(
        options.config?.features && (options.config.features as Record<string, boolean>).shell_tool,
        true,
      );
      assert.match(options.configOverrides![0], /":root" = "deny"/);
      assert.ok(!options.configOverrides![0].includes('"/proc" = "read"'));
      assert.ok(
        options.configOverrides![0].includes(
          `${JSON.stringify(directory)} = "${readOnly ? 'read' : 'write'}"`,
        ),
      );
      const result = spawnSync(
        process.execPath,
        [
          entry,
          'debug',
          'prompt-input',
          'Offline coding profile check.',
          ...codexConfigArgs(options),
          '--config',
          'cli_auth_credentials_store="ephemeral"',
        ],
        {
          cwd: directory,
          env: { ...options.env, CODEX_HOME: testCodexHome },
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      assert.equal(result.status, 0, 'Native CLI must accept the complete coding profile.');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native coding sandbox enforces project writes and a denied sibling file when supported by the host', async (t) => {
  const result = await checkCodingSandbox();
  if (!result.ready) {
    t.skip(result.message);
    return;
  }
  assert.match(result.message, /Offline coding check passed/);
});

test('structured native work retains acceptance evidence, supports explicit search, and blocks tool-free completion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-structured-code-')),
    ready = managedInfo.codexReady;
  managedInfo.codexReady = true;
  try {
    const entries: string[] = [],
      visible: ConsoleEvent[] = [];
    for (const withCommand of [true, false]) {
      const factory = (options: any): Pick<Codex, 'startThread'> => {
        assert.equal(options.config.web_search, 'live');
        return {
          startThread(thread) {
            assert.equal(thread?.webSearchMode, 'live');
            assert.equal(thread?.approvalPolicy, 'never');
            return {
              async runStreamed(_prompt: string, runOptions: any) {
                assert.ok(runOptions.outputSchema.required.includes('checks'));
                assert.ok(runOptions.outputSchema.properties.outcome.enum.includes('needs_input'));
                return {
                  events: (async function* (): AsyncGenerator<ThreadEvent> {
                    yield {
                      type: 'item.completed',
                      item: {
                        id: 'search',
                        type: 'web_search',
                        query: 'official package documentation',
                      },
                    } as ThreadEvent;
                    if (withCommand)
                      yield {
                        type: 'item.completed',
                        item: {
                          id: 'command',
                          type: 'command_execution',
                          command: 'node --test',
                          aggregated_output: '2 passing',
                          status: 'completed',
                          exit_code: 0,
                        },
                      };
                    yield {
                      type: 'item.completed',
                      item: { id: 'answer', type: 'agent_message', text: JSON.stringify(result()) },
                    };
                    yield {
                      type: 'turn.completed',
                      usage: {
                        input_tokens: 50,
                        output_tokens: 100,
                        cached_input_tokens: 0,
                        cache_write_input_tokens: 0,
                        reasoning_output_tokens: 0,
                      },
                    };
                  })(),
                };
              },
            } as ReturnType<Codex['startThread']>;
          },
        };
      };
      const answer = await codexWork(
        'A scoped engineering assignment',
        '{}',
        'fixture-model',
        directory,
        undefined,
        (e) => entries.push(e.type),
        false,
        false,
        factory,
        'medium',
        true,
        true,
        (e) => visible.push(e),
      );
      const value = JSON.parse(answer.text);
      assert.equal(value.outcome, withCommand ? 'complete' : 'blocked');
      if (!withCommand) assert.equal(value.checks.at(-1).status, 'not_met');
    }
    assert.ok(entries.includes('web search'));
    assert.ok(entries.includes('command'));
    assert.ok(visible.some((e) => e.type === 'command' && /2 passing/.test(e.text)));
  } finally {
    managedInfo.codexReady = ready;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('coding workers preserve their shared folder, stream tool evidence, reject text-only success and retain blocked reports', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-coding-contract-')),
    before = managedInfo.codexReady;
  managedInfo.codexReady = true;
  const entries: { type: string; detail: string }[] = [];
  const receipt: ThreadEvent = {
    type: 'turn.completed',
    usage: {
      input_tokens: 80,
      output_tokens: 20,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      reasoning_output_tokens: 0,
    },
  };
  function factory(events: ThreadEvent[]): Pick<Codex, 'startThread'> {
    return {
      startThread(options) {
        assert.equal(options?.workingDirectory, directory);
        assert.equal(options?.approvalPolicy, 'never');
        return {
          async runStreamed(prompt: string, runOptions: { outputSchema?: unknown }) {
            assert.match(prompt, /current project folder/);
            assert.ok(runOptions.outputSchema);
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
  const message = (outcome: string): ThreadEvent => ({
    type: 'item.completed',
    item: {
      id: 'result',
      type: 'agent_message',
      text: JSON.stringify({ outcome, summary: '# Actual task report' }),
    },
  });
  const command: ThreadEvent = {
    type: 'item.completed',
    item: {
      id: 'cmd',
      type: 'command_execution',
      command: 'node --test',
      aggregated_output: 'not copied into tool log',
      exit_code: 0,
      status: 'completed',
    },
  };
  try {
    const output = await codexWork(
      'Role: engineer',
      'Implement this project',
      'gpt-6.1-sol',
      directory,
      undefined,
      (e) => entries.push(e),
      false,
      false,
      () => factory([command, message('complete'), receipt]),
    );
    assert.equal(JSON.parse(output.text).outcome, 'complete');
    assert.equal(output.inputTokens, 80);
    assert.equal(existsSync(directory), true);
    assert.deepEqual(entries, [
      { id: 'cmd', type: 'command', detail: 'node --test\nExit code: 0', status: 'completed' },
    ]);
    const empty = await codexWork(
      'Role: reviewer',
      'Review the actual files',
      'gpt-6.1-sol',
      directory,
      undefined,
      undefined,
      false,
      true,
      () => factory([message('complete'), receipt]),
    );
    assert.equal(JSON.parse(empty.text).outcome, 'blocked');
    assert.match(JSON.parse(empty.text).summary, /has not been verified/);
    const blocked = await codexWork(
      'Role: tester',
      'Run checks',
      'gpt-6.1-sol',
      directory,
      undefined,
      undefined,
      false,
      false,
      () => factory([command, message('blocked'), receipt]),
    );
    assert.equal(JSON.parse(blocked.text).outcome, 'blocked');
    assert.equal(JSON.parse(blocked.text).summary, '# Actual task report');
    await assert.rejects(
      () =>
        codexWork(
          'Role: reviewer',
          'Review',
          'gpt-6.1-sol',
          directory,
          undefined,
          undefined,
          false,
          false,
          () => factory([command]),
        ),
      /CODEX_NO_RECEIPT/,
    );
  } finally {
    managedInfo.codexReady = before;
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

test('Codex applies the selected reasoning effort and permits only opted-in web search in research mode', async () => {
  const before = managedInfo.codexReady;
  managedInfo.codexReady = true;
  const tools: string[] = [];
  const factory = (events: ThreadEvent[]): Pick<Codex, 'startThread'> => ({
    startThread(options) {
      assert.equal(options?.modelReasoningEffort, 'high');
      assert.equal(options?.webSearchMode, 'live');
      assert.equal(options?.approvalPolicy, 'never');
      return {
        async runStreamed(prompt: string) {
          assert.match(prompt, /Cite direct source URLs/);
          return {
            events: (async function* () {
              for (const event of events) yield event;
            })(),
          };
        },
      } as ReturnType<Codex['startThread']>;
    },
  });
  const search: ThreadEvent = {
    type: 'item.completed',
    item: {
      id: 'search',
      type: 'web_search',
      query: 'specific buyer alternatives current pricing',
    },
  };
  const message: ThreadEvent = {
    type: 'item.completed',
    item: {
      id: 'answer',
      type: 'agent_message',
      text: '# Evidence\n\nExample source: https://example.org/research — identify dates and limitations.',
    },
  };
  const receipt: ThreadEvent = {
    type: 'turn.completed',
    usage: {
      input_tokens: 30,
      output_tokens: 20,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      reasoning_output_tokens: 0,
    },
  };
  try {
    const result = await codexGenerate(
      'Research the evidence',
      'Compare buyer alternatives',
      'gpt-6.1-sol',
      undefined,
      false,
      () => factory([search, message, receipt]),
      'high',
      { enabled: true, onTool: (e) => tools.push(e.detail) },
    );
    assert.equal(
      result.text,
      message.type === 'item.completed' && message.item.type === 'agent_message'
        ? message.item.text
        : '',
    );
    assert.deepEqual(tools, ['specific buyer alternatives current pricing']);
    const command: ThreadEvent = {
      type: 'item.started',
      item: {
        id: 'cmd',
        type: 'command_execution',
        command: 'touch outside.txt',
        aggregated_output: '',
        status: 'in_progress',
      },
    };
    await assert.rejects(
      () =>
        codexGenerate(
          'Research',
          'Assignment',
          'gpt-6.1-sol',
          undefined,
          false,
          () => factory([command]),
          'high',
          { enabled: true },
        ),
      /CODEX_TOOL_BLOCKED/,
    );
  } finally {
    managedInfo.codexReady = before;
  }
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
