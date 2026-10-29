process.env.WORKROOM_DEMO = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { guarded } from '../server/policy.js';
import { backupSchema, stateSchema } from '../shared/schemas.js';
import { refreshManagedInfo, managedInfo } from '../server/managed.js';
import { modelReadiness } from '../shared/model-readiness.js';
import { runtimeInfo } from '../server/providers.js';
import { commandKind, evidenceGaps } from '../server/verification.js';
import { result } from './work-fixtures.js';
import type { Task } from '../shared/types.js';

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'The expected worker transition did not occur.');
    await delay(5);
  }
}

function row(projectId: string, id = 'audit-task'): Task {
  return {
    id,
    projectId,
    title: 'A useful assignment',
    description: 'Produce the requested result and verify it.',
    agentId: 'mira',
    dependencies: [],
    status: 'queued',
    requiresApproval: false,
    output: '',
    feedback: '',
  };
}

test('thousands of activity events survive paging, editing, restart and backup round-trip without entering agent context', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-history-'));
  let store = new Store(join(directory, 'state.sqlite'));
  let engine = new Engine(store);
  try {
    const project = await engine.createProject(
      'Long history',
      'Keep a complete history while preserving a small current feed.',
      'office',
      'manual',
    );
    for (let i = 0; i < 1305; i++)
      engine.event(project.id, i % 2 ? 'message' : 'system', `Journal entry ${i}`);
    engine.editPlan(project.id, [row(project.id)]);
    assert.equal(store.state.activities.length, 250);
    stateSchema.parse(store.state);
    const backup = backupSchema.parse(store.backup());
    assert.equal(
      backup.activityHistory!.filter((a) => a.message.startsWith('Journal entry')).length,
      1305,
    );
    const ids: string[] = [];
    let cursor: number | undefined;
    do {
      const page = store.activityPage(project.id, cursor, 'message');
      ids.push(...page.entries.map((a) => a.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(ids.length, 652);
    assert.equal(new Set(ids).size, ids.length);
    engine.stop();
    store.close();
    store = new Store(join(directory, 'state.sqlite'));
    engine = new Engine(store);
    assert.equal(
      store.backup().activityHistory!.filter((a) => a.message.startsWith('Journal entry')).length,
      1305,
    );
    store.restore(backup);
    assert.equal(store.activityPage(project.id).entries.length, 100);
    assert.equal(store.backup().activityHistory!.length, backup.activityHistory!.length);
    // Model context consists of task evidence/verified memory, never this journal.
    assert.equal(JSON.stringify(store.state.tasks).includes('Journal entry'), false);
  } finally {
    engine.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('existing oversized workspace histories migrate into the journal without losing events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-history-upgrade-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path);
  try {
    const state = structuredClone(store.state),
      project = state.projects[0];
    state.activities = Array.from({ length: 1101 }, (_, i) => ({
      id: `legacy-${i}`,
      projectId: project.id,
      type: 'system' as const,
      message: `Legacy ${i}`,
      createdAt: 2000 - i,
    }));
    store.close();
    const db = new DatabaseSync(path);
    db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify(state));
    db.close();
    store = new Store(path);
    assert.equal(store.state.activities.length, 250);
    assert.equal(
      store.backup().activityHistory!.filter((a) => a.id.startsWith('legacy-')).length,
      1101,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a response checkpoint survives the receipt/output crash boundary and recovers offline exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-checkpoint-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path),
    engine = new Engine(store),
    calls = 0;
  try {
    const project = await engine.createProject(
      'Recover reply',
      'Preserve a completed model result across a process interruption.',
      'office',
      'manual',
    );
    project.provider = 'ollama';
    project.model = 'fixture';
    project.status = 'running';
    const task = row(project.id);
    task.status = 'working';
    store.state.tasks.push(task);
    await guarded(
      'ollama',
      'instructions',
      'assignment',
      {
        store,
        project,
        task,
        cache: false,
        onAttempt: (id) => {
          task.attemptId = id;
          store.save();
        },
      },
      async () => {
        calls++;
        return { text: JSON.stringify(result()), inputTokens: 10, outputTokens: 20 };
      },
    );
    const attempt = store.attempts().at(-1)!;
    assert.equal(attempt.status, 'completed');
    assert.equal(store.state.tasks.at(-1)!.output, '');
    // Deliberately stop before the engine's result transition can be saved.
    engine.stop();
    store.close();
    store = new Store(path);
    engine = new Engine(store);
    assert.equal(engine.task(task.id).status, 'failed');
    assert.equal(engine.task(task.id).recovery?.hasResponse, true);
    assert.equal(engine.project(project.id).status, 'paused');
    engine.recoverTask(task.id);
    assert.equal(engine.task(task.id).status, 'done');
    assert.equal(engine.task(task.id).output, result().deliverable);
    assert.equal(calls, 1);
    assert.equal(store.attempts().length, 1);
    assert.throws(() => engine.recoverTask(task.id), /no interrupted result/);
    const backup = store.backup();
    store.restore(backup);
    assert.equal(store.attemptResult(attempt.id)?.text, JSON.stringify(result()));
  } finally {
    engine.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('completed legacy receipts without a response cannot be silently replayed on Resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-no-replay-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path),
    engine = new Engine(store);
  try {
    const project = await engine.createProject(
      'Legacy receipt',
      'Hold completed requests whose output was not checkpointed.',
      'office',
      'manual',
    );
    const task = { ...row(project.id), status: 'working' as const, attemptId: 'receipt' };
    store.state.tasks.push(task);
    project.status = 'running';
    store.putAttempt({
      id: 'receipt',
      projectId: project.id,
      taskId: task.id,
      provider: 'demo',
      phase: 'task',
      status: 'completed',
      reservedUsd: 0,
      createdAt: Date.now(),
    });
    store.save();
    engine.stop();
    store.close();
    store = new Store(path);
    engine = new Engine(store);
    assert.equal(engine.task(task.id).status, 'failed');
    assert.equal(engine.task(task.id).recovery?.hasResponse, false);
    engine.runProject(project.id);
    engine.tick();
    assert.equal(engine.task(task.id).status, 'failed');
    assert.equal(store.attempts().length, 1);
  } finally {
    engine.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('installed project models remain selectable when unrelated Ollama and compatible defaults are missing', async () => {
  const previous = { ...process.env },
    fetch = globalThis.fetch;
  const info = structuredClone(managedInfo);
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    process.env.WORKROOM_CODEX_ENABLED = '0';
    process.env.OLLAMA_MODEL = 'absent';
    process.env.COMPATIBLE_API_URL = 'http://127.0.0.1:1234/v1';
    process.env.COMPATIBLE_MODEL = 'absent';
    process.env.COMPATIBLE_BILLING = 'local';
    globalThis.fetch = (async (url) =>
      String(url).endsWith('/api/tags')
        ? Response.json({ models: [{ name: 'installed:4b' }] })
        : Response.json({ data: [{ id: 'installed-compatible' }] })) as typeof fetch;
    await refreshManagedInfo();
    const project = await engine.createProject(
      'Exact model',
      'Use the exact installed model selected by this project.',
      'office',
      'manual',
    );
    engine.setProjectProvider(project.id, 'ollama', 'installed:4b');
    assert.equal(modelReadiness(runtimeInfo(), project.provider, project.model).ready, true);
    assert.equal(modelReadiness(runtimeInfo(), 'ollama', 'absent').ready, false);
    engine.setProjectProvider(project.id, 'compatible', 'installed-compatible');
    assert.throws(
      () => engine.setProjectProvider(project.id, 'compatible', 'absent'),
      /does not list/,
    );
  } finally {
    engine.stop();
    store.close();
    globalThis.fetch = fetch;
    Object.assign(managedInfo, info);
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test('editing an idle project preserves active worker identity and eventual output in another project', async () => {
  const store = new Store(':memory:');
  let finish!: (value: string) => void;
  const engine = new Engine(
    store,
    1,
    async () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const a = await engine.createProject(
      'Active project',
      'Run a held worker while another project is edited.',
      'office',
      'manual',
    );
    const b = await engine.createProject(
      'Idle project',
      'Allow independent edits without detaching the active task.',
      'office',
      'manual',
    );
    engine.editPlan(a.id, [row(a.id, 'active-task')]);
    engine.runProject(a.id);
    await waitUntil(() => typeof finish === 'function');
    const active = engine.task('active-task');
    engine.editPlan(b.id, [row(b.id, 'idle-task')]);
    engine.configureCollaboration(b.id, {
      reasoningEffort: 'medium',
      meetingPolicy: { enabled: false, everyTasks: 3 },
    });
    assert.strictEqual(engine.task(active.id), active);
    finish('# Confirmed worker result');
    await waitUntil(() => engine.task(active.id).status === 'done');
    assert.equal(engine.task(active.id).status, 'done');
    assert.equal(
      store.state.tasks.find((t) => t.id === active.id)!.output,
      '# Confirmed worker result',
    );
  } finally {
    engine.stop();
    store.close();
  }
});

test('verification rejects trivial commands and binds stable criteria to observed evidence', () => {
  assert.equal(commandKind('pwd'), undefined);
  assert.equal(commandKind('echo "npm test"'), undefined);
  assert.equal(commandKind('ls -la'), undefined);
  assert.equal(commandKind('npm test; true'), undefined);
  assert.equal(commandKind('npm test || true'), undefined);
  assert.equal(commandKind('npm test'), 'verification');
  assert.equal(commandKind("/bin/bash -lc 'node --test'"), 'verification');
  const task = {
    workType: 'implementation' as const,
    acceptanceCriteria: [
      { id: 'c1', description: 'Tests pass', evidence: 'verification' as const },
    ],
  };
  assert.ok(evidenceGaps(task, [], result()).length);
  const observations = [
    { id: 'file', kind: 'artifact' as const, reference: 'sum.js', detail: 'add' },
    {
      id: 'test',
      kind: 'verification' as const,
      reference: 'node --test',
      detail: '2 tests passed',
    },
  ];
  assert.ok(
    evidenceGaps(task, observations, result()).length,
    'Unrelated checks do not cover the assigned criterion',
  );
  assert.deepEqual(
    evidenceGaps(
      task,
      observations,
      result({
        checks: [
          {
            criterion: 'c1: Tests pass',
            status: 'met',
            evidence: 'node --test exited 0 with two passing tests.',
          },
        ],
      }),
    ),
    [],
  );
});

test('late HTTP snapshots cannot overwrite newer event-stream state, while a restarted server can replace it', async () => {
  const { newerSnapshot } = await import('../shared/snapshots.js');
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    const current = { ...engine.bootstrap(), serverId: 'one', revision: 10 };
    assert.strictEqual(newerSnapshot(current, { ...current, revision: 9 }), current);
    const restart = { ...current, serverId: 'two', revision: 1 };
    assert.strictEqual(newerSnapshot(current, restart), restart);
  } finally {
    engine.stop();
    store.close();
  }
});

test('a late reply after cancellation is held for offline recovery and cannot dispatch again while stopping', async () => {
  const info = structuredClone(managedInfo);
  managedInfo.ollamaReady = true;
  managedInfo.ollamaModels = ['fixture'];
  const store = new Store(':memory:');
  let finish!: (value: { text: string; inputTokens: number; outputTokens: number }) => void;
  let calls = 0;
  const engine = new Engine(
    store,
    1,
    async (_provider, project, task, _agent, _context, _signal, ctx) =>
      guarded(
        'ollama',
        'instructions',
        'assignment',
        { ...ctx, store, project, task, cache: false },
        () => {
          calls++;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      ),
  );
  try {
    store.state.provider = 'ollama';
    const project = await engine.createProject(
      'Late reply',
      'Hold a result received after cancellation instead of silently retrying.',
      'office',
      'manual',
    );
    project.model = 'fixture';
    engine.editPlan(project.id, [row(project.id)]);
    engine.runProject(project.id);
    assert.equal(calls, 1);
    engine.pauseProject(project.id);
    assert.equal(engine.task('audit-task').status, 'failed');
    assert.throws(() => engine.retryTask('audit-task'), /worker to stop/);
    assert.throws(
      () => engine.setProjectProvider(project.id, 'ollama', 'fixture'),
      /Pause the project/,
    );
    finish({ text: JSON.stringify(result()), inputTokens: 10, outputTokens: 20 });
    await waitUntil(() => !!engine.task('audit-task').recovery?.hasResponse);
    assert.equal(engine.task('audit-task').recovery?.hasResponse, true);
    engine.runProject(project.id);
    engine.tick();
    assert.equal(calls, 1);
    engine.recoverTask('audit-task');
    assert.equal(engine.task('audit-task').status, 'done');
    assert.equal(calls, 1);
  } finally {
    engine.stop();
    store.close();
    Object.assign(managedInfo, info);
  }
});

test('editing an interrupted assignment invalidates stale recovery without erasing its saved receipt or reply', async () => {
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    const project = await engine.createProject(
      'Changed assignment',
      'Prevent an old reply from satisfying a revised assignment.',
      'office',
      'manual',
    );
    const task = {
      ...row(project.id),
      status: 'failed' as const,
      attemptId: 'old',
      recovery: { attemptId: 'old', hasResponse: true },
    };
    store.state.tasks.push(task);
    store.completeAttempt(
      {
        id: 'old',
        projectId: project.id,
        taskId: task.id,
        provider: 'demo',
        phase: 'task',
        status: 'completed',
        reservedUsd: 0,
        createdAt: Date.now(),
      },
      { text: JSON.stringify(result()) },
    );
    engine.editPlan(project.id, [
      { ...task, description: 'A different assignment with different acceptance criteria.' },
    ]);
    assert.equal(engine.task(task.id).recovery, undefined);
    assert.equal(store.attemptResult('old')?.text, JSON.stringify(result()));
    assert.throws(() => engine.recoverTask(task.id), /no interrupted result/);
  } finally {
    engine.stop();
    store.close();
  }
});
