process.env.WORKROOM_DEMO = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { parse } from 'dotenv';
import { ConnectionSettings, patchEnv } from '../server/connection-settings.js';
import { codexReadiness } from '../server/codex-readiness.js';
import { CodexLogin, devicePrompt } from '../server/codex-login.js';
import { refreshManagedInfo, managedInfo } from '../server/managed.js';
import { runtimeInfo } from '../server/providers.js';
import { connectionInfo } from '../shared/connections.js';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { defaultPolicy } from '../shared/schemas.js';

test('connection saves preserve unrelated settings and comments, replace duplicate keys, and never reveal saved secrets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-settings-'));
  const env: NodeJS.ProcessEnv = {
    OPENAI_API_KEY: 'retained-key',
    OPENAI_MODEL: 'old',
    RUNNER_TOKEN: 'retained-runner',
  };
  try {
    writeFileSync(
      join(directory, '.env'),
      '# Keep this comment\r\nRUNNER_TOKEN=retained-runner\r\nexport OPENAI_MODEL=old\r\nOPENAI_MODEL=duplicate\r\nOPENAI_API_KEY="retained-key"\r\nUNRELATED="two\r\nlines"\r\n',
    );
    const settings = new ConnectionSettings(directory, env),
      initial = settings.view();
    assert.equal(JSON.stringify(initial).includes('retained-key'), false);
    const saved = settings.save({
      provider: 'openai',
      revision: initial.revision,
      model: 'new-model',
      apiKey: '',
    });
    assert.equal(saved.openai.hasKey, true);
    assert.equal(env.OPENAI_MODEL, 'new-model');
    assert.equal(env.OPENAI_API_KEY, 'retained-key');
    const source = readFileSync(join(directory, '.env'), 'utf8'),
      parsed = parse(source);
    assert.equal(source.match(/OPENAI_MODEL=/g)!.length, 1);
    assert.ok(source.startsWith('# Keep this comment\r\n'));
    assert.equal(parsed.RUNNER_TOKEN, 'retained-runner');
    assert.equal(parsed.UNRELATED, 'two\nlines');
    assert.equal(parsed.OPENAI_API_KEY, 'retained-key');
    const cleared = settings.save({
      provider: 'openai',
      revision: saved.revision,
      model: 'new-model',
      clearKey: true,
    });
    assert.equal(cleared.openai.hasKey, false);
    assert.equal(parse(readFileSync(join(directory, '.env'), 'utf8')).OPENAI_API_KEY, '');
    if (process.platform !== 'win32')
      assert.equal(statSync(join(directory, '.env')).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('conflicting file edits and invalid connection values cannot overwrite settings or inject environment assignments', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-settings-conflict-'));
  try {
    const settings = new ConnectionSettings(directory, {}),
      initial = settings.view();
    writeFileSync(join(directory, '.env'), '# External edit\nPORT=3010\n');
    assert.throws(
      () =>
        settings.save({
          provider: 'codex',
          revision: initial.revision,
          enabled: true,
          model: 'fixture',
        }),
      /changed elsewhere/,
    );
    const current = settings.view(),
      source = readFileSync(join(directory, '.env'), 'utf8');
    assert.throws(() =>
      settings.save({
        provider: 'gemini',
        revision: current.revision,
        model: 'fixture',
        apiKey: 'key\nRUNNER_TOKEN=oops',
      }),
    );
    assert.throws(() =>
      settings.save({
        provider: 'ollama',
        revision: current.revision,
        model: 'fixture',
        url: 'http://remote.example:11434',
      }),
    );
    assert.equal(readFileSync(join(directory, '.env'), 'utf8'), source);
    assert.equal(
      patchEnv(
        'OTHER="line one\nOPENAI_MODEL=inside a quoted value\nline three"\nOPENAI_MODEL=old\n',
        { OPENAI_MODEL: 'new' },
      ),
      'OTHER="line one\nOPENAI_MODEL=inside a quoted value\nline three"\nOPENAI_MODEL=\'new\'\n',
    );
    assert.equal(
      patchEnv('TOKEN="old\nvalue"\nKEEP=yes\n', { TOKEN: 'new' }),
      "TOKEN='new'\nKEEP=yes\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Codex diagnostics distinguish a disabled server, CLI errors and ChatGPT authentication without requiring an unrelated default model', () => {
  assert.equal(
    codexReadiness(false, { output: 'Logged in using ChatGPT', available: true }, 'fixture').code,
    'disabled',
  );
  assert.equal(
    codexReadiness(true, { output: '', available: false }, 'fixture').code,
    'cli_unavailable',
  );
  assert.equal(
    codexReadiness(true, { output: 'Not logged in', available: true }, 'fixture').code,
    'signed_out',
  );
  assert.equal(
    codexReadiness(true, { output: 'Logged in using an API key', available: true }, 'fixture').code,
    'api_key',
  );
  const signedIn = codexReadiness(true, { output: 'Logged in using ChatGPT', available: true }, '');
  assert.equal(signedIn.ready, true);
  assert.match(signedIn.message, /no default model/i);
});

test('key presence stays unchecked, exact model metadata turns green, and a changed key invalidates that check', async () => {
  const env = { ...process.env },
    fetch = globalThis.fetch,
    info = structuredClone(managedInfo);
  try {
    process.env.OPENAI_API_KEY = 'fixture-key';
    process.env.OPENAI_MODEL = 'default';
    process.env.WORKROOM_CODEX_ENABLED = '0';
    delete process.env.GEMINI_API_KEY;
    delete process.env.COMPATIBLE_API_URL;
    assert.equal(connectionInfo(runtimeInfo(), 'openai').state, 'configured');
    globalThis.fetch = (async (url, options) => {
      assert.equal(options?.method, undefined, 'Readiness checks never request generation');
      if (String(url).includes('/api/tags')) return Response.json({ models: [] });
      return Response.json({ id: 'project-model' });
    }) as typeof fetch;
    await refreshManagedInfo(true, { provider: 'openai', model: 'project-model' });
    const runtime = runtimeInfo([{ provider: 'openai', model: 'project-model' }]);
    assert.equal(connectionInfo(runtime, 'openai', 'project-model').state, 'connected');
    assert.equal(connectionInfo(runtime, 'openai', 'default').state, 'configured');
    process.env.OPENAI_API_KEY = 'replacement-key';
    assert.equal(
      connectionInfo(
        runtimeInfo([{ provider: 'openai', model: 'project-model' }]),
        'openai',
        'project-model',
      ).state,
      'configured',
    );
    assert.equal(managedInfo.codexCode, 'disabled');
  } finally {
    globalThis.fetch = fetch;
    Object.assign(managedInfo, info);
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});

test('project edits preserve identity, original briefs, completed work, folders and model; stale edits are rejected', async () => {
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    const project = await engine.createProject(
      'Original name',
      'Original project goal with a useful requested outcome.',
      'office',
      'manual',
    );
    const original = structuredClone(project);
    store.state.tasks.push({
      id: 'saved-task',
      projectId: project.id,
      title: 'Earlier result',
      description: 'Useful saved work.',
      agentId: 'mira',
      dependencies: [],
      status: 'done',
      requiresApproval: false,
      output: '# Earlier result',
      feedback: '',
    });
    engine.updateProject(project.id, {
      title: 'Updated name',
      brief: 'Updated project goal with different acceptance criteria.',
      reason: 'Refined the outcome.',
      expectedUpdatedAt: project.createdAt,
    });
    assert.equal(project.id, original.id);
    assert.equal(project.provider, original.provider);
    assert.equal(project.model, original.model);
    assert.equal(project.workspaceFolder, original.workspaceFolder);
    assert.equal(project.briefHistory?.[0].brief, original.brief);
    assert.equal(project.briefRevision, 1);
    assert.equal(engine.task('saved-task').output, '# Earlier result');
    assert.throws(
      () =>
        engine.updateProject(project.id, {
          title: 'Stale edit',
          brief: original.brief,
          expectedUpdatedAt: project.createdAt,
        }),
      /changed since/,
    );
    store.restore(store.backup());
    assert.equal(store.state.projects.find((p) => p.id === project.id)?.briefHistory?.length, 1);
    assert.equal(store.state.policy?.allowPaid, defaultPolicy.allowPaid);
    const owner = engine.beginConnectionChange('Signing in.');
    assert.throws(() => engine.runProject(project.id), /setup to finish/);
    assert.equal(engine.bootstrap().connectionChange, 'Signing in.');
    engine.endConnectionChange(owner);
    engine.project(project.id).status = 'running';
    assert.throws(() => engine.assertConnectionsIdle(), /Pause running/);
  } finally {
    engine.stop();
    store.close();
  }
});

test('a delayed readiness response cannot certify replacement credentials or overwrite a newer model list', async () => {
  const previous = { ...process.env },
    fetch = globalThis.fetch,
    info = structuredClone(managedInfo);
  let completeOld!: (value: Response) => void, reached!: () => void;
  const pending = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let lists = 0;
  try {
    process.env.WORKROOM_CODEX_ENABLED = '0';
    process.env.OPENAI_API_KEY = 'old-fixture';
    process.env.OPENAI_MODEL = 'race-model';
    delete process.env.GEMINI_API_KEY;
    delete process.env.COMPATIBLE_API_URL;
    globalThis.fetch = (async (url, options) => {
      if (String(url).includes('/api/tags'))
        return Response.json({ models: [{ name: ++lists === 1 ? 'old-model' : 'new-model' }] });
      const auth = (options?.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer old-fixture') {
        reached();
        return new Promise<Response>((resolve) => {
          completeOld = resolve;
        });
      }
      return Response.json({}, { status: 403 });
    }) as typeof fetch;
    const older = refreshManagedInfo(true);
    await pending;
    process.env.OPENAI_API_KEY = 'replacement-fixture';
    await refreshManagedInfo(true);
    completeOld(Response.json({ id: 'race-model' }));
    await older;
    assert.equal(connectionInfo(runtimeInfo(), 'openai').state, 'unavailable');
    assert.deepEqual(managedInfo.ollamaModels, ['new-model']);
  } finally {
    globalThis.fetch = fetch;
    Object.assign(managedInfo, info);
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
    Object.assign(process.env, previous);
  }
});

test('reload reads externally edited saved values, and a blank key keeps and applies the saved key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-reload-'));
  const env = { OPENAI_MODEL: 'active-old-model', OPENAI_API_KEY: 'active-old-key' };
  try {
    writeFileSync(
      join(directory, '.env'),
      'OPENAI_MODEL=saved-new-model\nOPENAI_API_KEY=saved-new-key\nOTHER_SETTING=keep\n',
    );
    const settings = new ConnectionSettings(directory, env),
      reloaded = settings.view();
    assert.equal(reloaded.openai.model, 'saved-new-model');
    assert.equal(reloaded.openai.hasKey, true);
    assert.equal(JSON.stringify(reloaded).includes('saved-new-key'), false);
    assert.equal(
      env.OPENAI_API_KEY,
      'active-old-key',
      'Reload alone cannot switch credentials during work',
    );
    settings.save({
      provider: 'openai',
      revision: reloaded.revision,
      model: reloaded.openai.model,
    });
    assert.equal(env.OPENAI_MODEL, 'saved-new-model');
    assert.equal(env.OPENAI_API_KEY, 'saved-new-key');
    assert.match(readFileSync(join(directory, '.env'), 'utf8'), /OTHER_SETTING=keep/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('saving the free community preset replaces old private credentials and rejects arbitrary remote billing exemptions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-community-settings-'));
  const env: NodeJS.ProcessEnv = {
    COMPATIBLE_API_KEY: 'old-private-fixture-key',
    COMPATIBLE_API_URL: 'https://old-provider.example/v1',
    COMPATIBLE_BILLING: 'api',
  };
  try {
    writeFileSync(join(directory, '.env'), 'COMPATIBLE_API_KEY=old-private-fixture-key\n');
    const settings = new ConnectionSettings(directory, env);
    const change = {
      provider: 'compatible',
      model: 'community-fixture-not-live',
      billing: 'community',
      apiKey: '',
      url: 'https://example.com/v1',
      revision: settings.view().revision,
    };
    assert.throws(() => settings.save(change), /restricted to the official AI Horde/);
    assert.equal(env.COMPATIBLE_API_KEY, 'old-private-fixture-key');
    settings.save({ ...change, url: 'https://oai.aihorde.net/v1' });
    assert.equal(env.COMPATIBLE_API_KEY, '0000000000');
    assert.equal(env.COMPATIBLE_BILLING, 'community');
    assert.equal(settings.view().compatible.billing, 'community');
    assert.equal(
      readFileSync(join(directory, '.env'), 'utf8').includes('old-private-fixture-key'),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
