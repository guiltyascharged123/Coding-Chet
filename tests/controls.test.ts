process.env.WORKROOM_DEMO = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { initialState } from '../server/seed.js';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { guarded, reserve, selectedMemory, relevantContext } from '../server/policy.js';
import { defaultPolicy } from '../shared/schemas.js';

test('legacy databases retain outputs and create a validated recovery snapshot before migration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-legacy-')),
    path = join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(path),
    legacy = initialState();
  legacy.tasks[0].output = '# Retained legacy document';
  legacy.tasks[0].status = 'done';
  database.exec('CREATE TABLE workspace (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
  database.prepare('INSERT INTO workspace VALUES(1,?)').run(JSON.stringify(legacy));
  database.close();
  const store = new Store(path);
  try {
    assert.equal(store.state.schemaVersion, 4);
    assert.equal(store.state.tasks[0].output, legacy.tasks[0].output);
    assert.equal(store.state.policy?.allowPaid, false);
    const folder = join(directory, 'backups'),
      file = readdirSync(folder)[0];
    assert.ok(file.startsWith('before-upgrade-'));
    const snapshot = JSON.parse(readFileSync(join(folder, file), 'utf8'));
    store.restore(snapshot);
    assert.equal(store.state.tasks[0].output, legacy.tasks[0].output);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('new projects use a free starter plan and changing defaults preserves existing projects', async () => {
  const key = process.env.OPENAI_API_KEY,
    fetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-placeholder';
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    globalThis.fetch = (async () => {
      throw new Error('No model call expected.');
    }) as typeof fetch;
    const old = engine.state.projects[0];
    engine.setProvider('openai');
    assert.equal(old.provider, 'demo');
    const project = await engine.createProject(
      'Office pack',
      'Plan an office move with budget, schedule and risks.',
      'office',
    );
    assert.equal(project.provider, 'openai');
    assert.equal(engine.state.tasks.filter((t) => t.projectId === project.id).length, 6);
    assert.equal(store.attempts().length, 0);
    engine.setProvider('demo');
    assert.equal(project.provider, 'openai');
    assert.equal(project.model, 'gpt-4.1-mini');
    engine.setProjectProvider(project.id, 'demo');
    assert.equal(project.provider, 'demo');
  } finally {
    engine.stop();
    store.close();
    globalThis.fetch = fetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});

test('paid reservations cover planning, retries, context, concurrency, and budgets before dispatch', async () => {
  const store = new Store(':memory:');
  try {
    const project = {
        ...store.state.projects[0],
        provider: 'openai' as const,
        model: 'test-model',
      },
      task = store.state.tasks[0];
    const ctx = { store, project, task, model: 'test-model' };
    let calls = 0;
    const generate = async () => {
      calls++;
      store.state.policy!.rates.openai!.inputPerMillion = 1000;
      return { text: '# Document', inputTokens: 100, outputTokens: 50 };
    };
    await assert.rejects(
      () => guarded('openai', 'system', 'assignment', ctx, generate),
      /Paid APIs are disabled/,
    );
    store.state.policy = { ...structuredClone(defaultPolicy), allowPaid: true };
    await assert.rejects(
      () => guarded('openai', 'system', 'assignment', ctx, generate),
      /price estimate/,
    );
    store.state.policy.rates.openai = {
      model: 'test-model',
      inputPerMillion: 1,
      outputPerMillion: 2,
    };
    store.state.policy.dailyBudgetUsd = 0;
    await assert.rejects(() => guarded('openai', 'system', 'assignment', ctx, generate), /budget/);
    assert.equal(calls, 0);
    store.state.policy.dailyBudgetUsd = 2;
    assert.throws(
      () => reserve(store, project, 'openai', 'plan', 'test-model', 25000),
      /context limit/,
    );
    const active = reserve(store, project, 'openai', 'plan', 'test-model', 100);
    assert.ok(active.reservedUsd > 0);
    assert.throws(
      () => reserve(store, project, 'openai', 'task', 'test-model', 100, task),
      /Another worker/,
    );
    store.putAttempt({ ...active, status: 'uncertain' });
    assert.equal(await guarded('openai', 'system', 'assignment', ctx, generate), '# Document');
    assert.equal(calls, 1);
    store.state.policy.rates.openai.inputPerMillion = 1;
    const receipt = store.attempts().find((a) => a.status === 'completed')!;
    assert.equal(receipt.model, 'test-model');
    assert.equal(receipt.billing, 'api');
    assert.equal(receipt.actualUsd, 0.0002);
    assert.equal(await guarded('openai', 'system', 'assignment', ctx, generate), '# Document');
    assert.equal(calls, 1);
    assert.equal(store.attempts().filter((a) => a.status === 'cached').length, 1);
    store.state.policy.maxRequests24h = 2;
    await assert.rejects(
      () => guarded('openai', 'system', 'revised assignment', ctx, generate),
      /request limit/,
    );
    store.state.policy.maxRequests24h = 30;
    await assert.rejects(
      () =>
        guarded('openai', 'system', 'revised assignment', ctx, async () => {
          throw new Error('Interrupted');
        }),
      /Interrupted/,
    );
    await assert.rejects(() => guarded('openai', 'system', 'retry', ctx, generate), /uncertain/);
    assert.equal(calls, 1);
  } finally {
    store.close();
  }
});

test('backup restore validates before replacing, preserves receipts, clears cache and disables paid APIs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-backup-')),
    store = new Store(join(directory, 'workspace.sqlite'));
  try {
    store.state.tasks[0].output = '# Original';
    store.save();
    const backup = store.backup(),
      invalid = structuredClone(backup);
    invalid.state.tasks[0].dependencies = [invalid.state.tasks[0].id];
    assert.throws(() => store.restore(invalid), /Cyclic/);
    assert.equal(store.state.tasks[0].output, '# Original');
    const receipt = reserve(
      store,
      store.state.projects[0],
      'codex',
      'task',
      'default',
      50,
      store.state.tasks[0],
    );
    store.putAttempt({ ...receipt, status: 'uncertain' });
    store.cache('example', '# Cached');
    backup.state.policy = { ...structuredClone(defaultPolicy), allowPaid: true };
    backup.state.tasks[0].status = 'working';
    backup.state.projects[0].status = 'running';
    store.restore(backup);
    assert.equal(store.state.tasks[0].status, 'failed');
    assert.equal(store.state.projects[0].status, 'paused');
    assert.equal(store.state.policy?.allowPaid, false);
    assert.equal(store.attempts()[0].id, receipt.id);
    assert.equal(store.cached('example'), undefined);
    assert.equal(readdirSync(join(directory, 'backups')).length, 1);
    assert.equal(store.backup().state.tasks[0].output, '# Original');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('only human-verified, current, project-scoped memory reaches relevant task context', () => {
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    const project = store.state.projects[0],
      source = store.state.tasks[0],
      task = store.state.tasks[1];
    source.status = 'done';
    source.output = '# Evidence';
    engine.addMemory(project.id, 'Approved scope stays local.', source.id);
    const memory = store.state.memory![0];
    assert.deepEqual(selectedMemory(store, project.id), []);
    engine.changeMemory(memory.id, 'verify');
    assert.equal(selectedMemory(store, project.id).length, 1);
    assert.deepEqual(selectedMemory(store, 'another-project'), []);
    assert.deepEqual(relevantContext(task, [source, store.state.tasks[5]]), [
      { title: source.title, output: source.output },
    ]);
    source.output = '# Changed evidence';
    assert.equal(selectedMemory(store, project.id).length, 0);
    assert.equal(engine.bootstrap().state.memory![0].stale, true);
    assert.throws(() => engine.changeMemory(memory.id, 'verify'), /stale/);
    engine.addMemory(project.id, 'A human-supplied constraint.');
    engine.changeMemory(store.state.memory![1].id, 'verify');
    assert.equal(selectedMemory(store, project.id).length, 1);
  } finally {
    engine.stop();
    store.close();
  }
});

test('restart holds interrupted request reservations and never automatically repeats charged work', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-restart-')),
    path = join(directory, 'state.sqlite');
  let store = new Store(path);
  try {
    const task = store.state.tasks[0],
      project = store.state.projects[0];
    task.attemptId = reserve(store, project, 'codex', 'task', 'default', 50, task).id;
    task.status = 'working';
    project.status = 'running';
    store.save();
    store.close();
    store = new Store(path);
    assert.equal(store.state.tasks[0].status, 'failed');
    assert.equal(store.state.projects[0].status, 'paused');
    assert.equal(store.attempts()[0].status, 'uncertain');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
