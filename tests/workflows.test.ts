import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { unzipSync, strFromU8 } from 'fflate';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import {
  projectWorkspace,
  workspaceFiles,
  workspaceFile,
  workspaceZip,
} from '../server/workspaces.js';
import { defaultPolicy, stateSchema } from '../shared/schemas.js';
import { managedInfo } from '../server/managed.js';
import type { Task } from '../shared/types.js';

async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Timed out waiting for state transition');
}
function enableMockApi(store: Store) {
  store.state.provider = 'openai';
  store.state.policy = {
    ...structuredClone(defaultPolicy),
    allowPaid: true,
    rates: { openai: { model: 'gpt-4.1-mini', inputPerMillion: 0, outputPerMillion: 0 } },
  };
}
const brief = 'Build a small local project with clear acceptance criteria and useful results.';
const proposed = {
  tasks: [
    {
      title: 'Agree scope',
      description: 'Confirm acceptance criteria.',
      agentId: 'mira',
      dependencies: [],
      requiresApproval: true,
    },
    {
      title: 'Deliver work',
      description: 'Produce the requested result.',
      agentId: 'sol',
      dependencies: [0],
      requiresApproval: false,
    },
  ],
};
const response = () =>
  Response.json({
    choices: [{ message: { content: JSON.stringify(proposed) } }],
    usage: { prompt_tokens: 10, completion_tokens: 10 },
  });

test('normal workspaces start empty; planning failure retains the original brief on disk and retry is idempotent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-durable-'));
  const env = process.env.WORKROOM_DEMO,
    key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL,
    fetch = globalThis.fetch;
  delete process.env.WORKROOM_DEMO;
  process.env.OPENAI_API_KEY = 'test-only';
  delete process.env.OPENAI_MODEL;
  const path = join(directory, 'workspace.sqlite'),
    store = new Store(path),
    engine = new Engine(store);
  try {
    assert.deepEqual(store.state.projects, []);
    enableMockApi(store);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      const reader = new DatabaseSync(path);
      const saved = JSON.parse(
        (reader.prepare('SELECT payload FROM workspace WHERE id=1').get() as { payload: string })
          .payload,
      );
      reader.close();
      assert.equal(saved.projects[0].brief, brief, 'brief is durable before dispatch');
      if (calls === 1) throw new Error('Simulated connection interruption');
      return response();
    }) as typeof fetch;
    const id = randomUUID();
    const p = await engine.createProject('Durable project', brief, 'office', 'ai', id, 'office');
    await until(() => p.planningStatus === 'failed');
    assert.equal(store.state.tasks.length, 0);
    assert.equal(p.brief, brief);
    assert.match(p.planningError!, /Simulated connection/);
    assert.throws(() => engine.runProject(p.id), /Finish or retry planning/);
    assert.equal(
      (await engine.createProject(p.title, brief, 'office', 'ai', id, 'office')).id,
      p.id,
    );
    assert.equal(calls, 1);
    assert.equal(store.state.projects.length, 1);
    await assert.rejects(
      () => engine.createProject('Changed content', brief, 'office', 'ai', id, 'office'),
      /different brief/,
    );
    assert.throws(() => engine.retryPlanning(id), /acknowledge uncertain/);
    engine.acknowledge(store.attempts()[0].id);
    engine.retryPlanning(id);
    assert.throws(() => engine.retryPlanning(id), /already active/);
    await until(() => p.planningStatus === 'ready');
    assert.equal(calls, 2);
    assert.equal(store.state.projects.length, 1);
    assert.equal(store.state.tasks.length, 2);
    assert.deepEqual(store.state.tasks[1].dependencies, [store.state.tasks[0].id]);
    assert.equal(store.attempts().filter((a) => a.projectId === p.id).length, 2);
  } finally {
    engine.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
    globalThis.fetch = fetch;
    if (env === undefined) delete process.env.WORKROOM_DEMO;
    else process.env.WORKROOM_DEMO = env;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
  }
});

test('invalid planner output is not replayed from cache and a stopped/restarted plan never loses its brief', async () => {
  const fetch = globalThis.fetch,
    key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-only';
  delete process.env.OPENAI_MODEL;
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    enableMockApi(store);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1
        ? Response.json({ choices: [{ message: { content: 'invalid JSON' } }] })
        : response();
    }) as typeof fetch;
    const p = await engine.createProject(
      'Invalid plan',
      brief,
      'office',
      'ai',
      randomUUID(),
      'research',
    );
    await until(() => p.planningStatus === 'failed');
    assert.equal(
      store.attempts()[0].status,
      'completed',
      'confirmed model usage survives a parse failure',
    );
    engine.retryPlanning(p.id);
    await until(() => p.planningStatus === 'ready');
    assert.equal(calls, 2);
    globalThis.fetch = ((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), {
          once: true,
        });
      })) as typeof fetch;
    const interrupted = await engine.createProject(
      'Interrupted planning',
      brief,
      'office',
      'ai',
      randomUUID(),
      'office',
    );
    assert.equal(interrupted.planningStatus, 'planning');
    assert.throws(() => engine.restore(store.backup()), /Pause all work/);
    const snapshot = store.backup();
    engine.pauseProject(interrupted.id);
    await until(() => store.attempts().every((a) => a.status !== 'running'));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(interrupted.planningStatus, 'failed');
    assert.equal(interrupted.brief, brief);
    store.restore(snapshot);
    const restored = store.state.projects.find((p) => p.id === interrupted.id)!;
    assert.equal(restored.planningStatus, 'failed');
    assert.equal(restored.status, 'paused');
    assert.equal(restored.brief, brief);
    engine.starterPlan(restored.id);
    assert.equal(restored.planningStatus, 'ready');
    assert.equal(store.state.tasks.filter((t) => t.projectId === restored.id).length, 0);
    assert.equal(restored.planning, 'manual');
    assert.equal(
      store.attempts().filter((a) => a.projectId === restored.id).length,
      1,
      'manual recovery makes no model call and inserts no canned tasks',
    );
  } finally {
    engine.stop();
    store.close();
    globalThis.fetch = fetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = model;
  }
});

test('plans extend beyond six tasks, validate dependencies, preserve history, and keep project roles separate', async () => {
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    const p = await engine.createProject(
      'Custom coordination',
      brief,
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    const original = structuredClone(store.state.tasks.filter((t) => t.projectId === p.id));
    const rows: Task[] = [...original];
    for (let i = 1; i < 9; i++)
      rows.push({
        ...original[0],
        id: randomUUID(),
        title: `Follow-up ${i}`,
        dependencies: [rows[i - 1].id],
        requiresApproval: false,
      });
    engine.editPlan(p.id, rows);
    assert.equal(store.state.tasks.filter((t) => t.projectId === p.id).length, 9);
    const invalid = structuredClone(rows);
    invalid[0].dependencies = [invalid[8].id];
    assert.throws(() => engine.editPlan(p.id, invalid), /Cyclic/);
    const saved = engine.task(rows[0].id);
    saved.status = 'done';
    saved.output = 'A retained decision';
    const changed = structuredClone(rows);
    changed[0].description = 'Overwrite completed history';
    assert.throws(() => engine.editPlan(p.id, changed), /retain their assignments/);
    assert.equal(engine.task(rows[0].id).output, 'A retained decision');
    const other = await engine.createProject(
      'Research coordination',
      brief,
      'office',
      'template',
      randomUUID(),
      'research',
    );
    const originalRole = other.team![0].role;
    engine.updateAgent(
      'mira',
      {
        name: 'Lead',
        role: 'Custom coordinator',
        specialty: 'Coordinate the approved delivery.',
        desk: 1,
      },
      p.id,
    );
    assert.equal(other.team![0].role, originalRole);
    assert.equal(p.team![0].desk, 1);
    assert.equal(p.team![1].desk, 0);
    assert.ok(stateSchema.safeParse(store.state).success);
  } finally {
    engine.stop();
    store.close();
  }
});

test('software workspaces use unique readable folders, expose real files, and exclude secrets and symlinks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-source-')),
    store = new Store(join(directory, 'workspace.sqlite')),
    engine = new Engine(store);
  const before = managedInfo.codingReady;
  try {
    const p = await engine.createProject(
      'Local Tools',
      brief,
      'office',
      'template',
      randomUUID(),
      'software',
    );
    const other = await engine.createProject(
      'Local Tools',
      brief,
      'office',
      'template',
      randomUUID(),
      'software',
    );
    const folder = projectWorkspace(store.path, p),
      second = projectWorkspace(store.path, other);
    assert.notEqual(folder, second);
    assert.match(p.workspaceFolder!, /^local-tools-[a-f0-9]{16}$/);
    assert.equal(store.state.tasks.filter((t) => t.projectId === p.id).length, 5);
    assert.equal(store.state.tasks.find((t) => t.projectId === p.id)!.readOnly, true);
    assert.throws(() => engine.runProject(p.id), /requires the Codex/);
    mkdirSync(join(folder, 'src'));
    writeFileSync(join(folder, 'src', 'main.js'), 'export const answer = 42;');
    writeFileSync(join(folder, '.env'), 'FAKE_SECRET=not-a-real-secret');
    mkdirSync(join(folder, 'node_modules'));
    writeFileSync(join(folder, 'node_modules', 'skip.js'), 'dependency');
    writeFileSync(join(directory, 'outside.txt'), 'not public');
    if (process.platform !== 'win32')
      symlinkSync(join(directory, 'outside.txt'), join(folder, 'link.txt'));
    assert.deepEqual(workspaceFiles(folder), [{ path: 'src/main.js', bytes: 25 }]);
    for (const name of [
      '../outside.txt',
      '.env',
      'node_modules/skip.js',
      'link.txt',
      '/etc/passwd',
    ])
      assert.throws(() => workspaceFile(folder, name));
    const zip = unzipSync(workspaceZip(folder));
    assert.deepEqual(Object.keys(zip), ['src/main.js']);
    assert.equal(strFromU8(zip['src/main.js']), 'export const answer = 42;');
    store.restore(store.backup());
    assert.equal(existsSync(join(folder, 'src/main.js')), true);
    const restored = store.state.projects.find((x) => x.id === p.id)!;
    assert.equal(projectWorkspace(store.path, restored), folder);
    restored.workspaceFolder = other.workspaceFolder;
    assert.throws(() => projectWorkspace(store.path, restored), /does not match/);
  } finally {
    managedInfo.codingReady = before;
    engine.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('software roles share real files through approval, blocked review, retry and an executed test', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workroom-delivery-')),
    store = new Store(join(root, 'workspace.sqlite'));
  const ready = managedInfo.codexReady,
    coding = managedInfo.codingReady;
  managedInfo.codexReady = true;
  managedInfo.codingReady = true;
  let reviews = 0;
  const roles: string[] = [],
    folders = new Set<string>();
  const engine = new Engine(
    store,
    1,
    async (_provider, _project, task, agent, _context, _signal, ctx) => {
      const folder = ctx!.workspace!;
      folders.add(folder);
      roles.push(agent.role);
      if (agent.role === 'Implementation engineer') {
        writeFileSync(join(folder, 'sum.cjs'), 'module.exports = (a, b) => a - b;');
        writeFileSync(
          join(folder, 'sum.test.cjs'),
          "const test = require('node:test'); const assert = require('node:assert/strict'); const sum = require('./sum.cjs'); test('adds', () => assert.equal(sum(2,3), 5));",
        );
      }
      if (agent.role === 'Code reviewer') {
        reviews++;
        assert.ok(readFileSync(join(folder, 'sum.cjs'), 'utf8').includes('module.exports'));
        if (reviews === 1)
          return JSON.stringify({
            outcome: 'blocked',
            summary: '# Review finding\n\nsum.cjs subtracts instead of adding.',
          });
        assert.match(task.feedback, /Correct addition/);
        writeFileSync(join(folder, 'sum.cjs'), 'module.exports = (a, b) => a + b;');
      }
      if (agent.role === 'Test engineer') {
        const childEnv = { ...process.env };
        delete childEnv.NODE_TEST_CONTEXT;
        const test = spawnSync(
          process.execPath,
          ['--test', '--test-reporter=tap', 'sum.test.cjs'],
          {
            cwd: folder,
            env: childEnv,
            encoding: 'utf8',
          },
        );
        assert.equal(test.status, 0, test.stderr);
        assert.match(test.stdout, /pass 1/);
        ctx!.onTool?.({
          id: 'test-result',
          type: 'command',
          detail: 'node --test sum.test.cjs\nExit code: 0',
          status: 'completed',
        });
      }
      return JSON.stringify({
        outcome: 'complete',
        summary: `# ${task.title}\n\nActual ${agent.role} result.`,
      });
    },
  );
  try {
    store.state.provider = 'codex';
    const p = await engine.createProject(
      'Addition utility',
      brief,
      'office',
      'template',
      randomUUID(),
      'software',
    );
    store.state.tasks.find((t) => t.projectId === p.id)!.requiresApproval = true;
    engine.start();
    p.model ||= 'offline-fixture-model';
    engine.runProject(p.id);
    await until(() =>
      store.state.approvals.some((a) => a.projectId === p.id && a.status === 'pending'),
    );
    assert.equal(
      existsSync(join(projectWorkspace(store.path, p), 'sum.cjs')),
      false,
      'implementation waits for human scope approval',
    );
    engine.review(store.state.approvals.find((a) => a.projectId === p.id)!.id, 'approve', '');
    await until(() => store.state.tasks.some((t) => t.projectId === p.id && t.status === 'failed'));
    const failed = store.state.tasks.find((t) => t.projectId === p.id && t.status === 'failed')!;
    assert.equal(p.status, 'paused');
    assert.match(failed.output, /subtracts instead/);
    assert.equal(
      store.state.tasks.filter((t) => t.projectId === p.id && t.status === 'done').length,
      2,
    );
    engine.retryTask(failed.id, 'Correct addition and repeat review.');
    await until(
      () =>
        p.status === 'completed' ||
        store.state.tasks.some((t) => t.projectId === p.id && t.status === 'failed'),
    );
    assert.equal(
      p.status,
      'completed',
      JSON.stringify(
        store.state.tasks
          .filter((t) => t.projectId === p.id)
          .map((t) => ({ title: t.title, status: t.status, error: t.error, feedback: t.feedback })),
      ),
    );
    assert.equal(folders.size, 1);
    assert.equal(reviews, 2);
    assert.ok(roles.includes('Implementation engineer'));
    assert.ok(roles.includes('Code reviewer'));
    assert.ok(roles.includes('Test engineer'));
    assert.match(
      store.state.tasks.find((t) => t.projectId === p.id && t.agentId === 'echo')!.toolLog![0]
        .detail,
      /Exit code: 0/,
    );
  } finally {
    engine.stop();
    store.close();
    managedInfo.codexReady = ready;
    managedInfo.codingReady = coding;
    rmSync(root, { recursive: true, force: true });
  }
});
