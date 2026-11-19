import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { policySchema, defaultPolicy, backupSchema } from '../shared/schemas.js';
import { validatePlan } from '../server/planning.js';
import { initialState } from '../server/seed.js';
import { Store } from '../server/store.js';
import { reserve } from '../server/policy.js';
import { runToolLoop } from '../server/tool-loop.js';
import { result } from './work-fixtures.js';
import { workResultSchema } from '../shared/work.js';

test('specialists can delegate more than three tasks and join branches beyond the former index ceiling', () => {
  const work = result({
    outcome: 'continue',
    followUps: Array.from({ length: 5 }, (_, i) => ({
      title: `Concrete branch ${i}`,
      description: 'Perform this independent useful assignment.',
      agentId: 'atlas',
      dependsOn: i ? [i - 1] : [],
    })),
  });
  assert.equal(workResultSchema.parse(work).followUps.length, 5);
});

test('workflow counts are unlimited by default while an explicit finite request budget is still enforceable', () => {
  const store = new Store(':memory:');
  try {
    const state = initialState(true),
      project = state.projects[0];
    project.provider = 'ollama';
    project.model = 'fixture';
    store.state = state;
    store.state.policy = { ...defaultPolicy, maxRequests24h: 1 };
    const first = reserve(store, project, 'ollama', 'task', 'fixture', 10, state.tasks[0]);
    store.putAttempt({ ...first, status: 'completed' });
    const second = reserve(store, project, 'ollama', 'task', 'fixture', 10, state.tasks[1]);
    store.putAttempt({ ...second, status: 'completed' });
    assert.equal(store.attempts().length, 2);
    store.state.policy.unlimitedWorkflow = false;
    assert.throws(
      () => reserve(store, project, 'ollama', 'task', 'fixture', 10, state.tasks[2]),
      /request limit/i,
    );
    assert.doesNotThrow(() =>
      policySchema.parse({
        ...defaultPolicy,
        maxTasks: 1000,
        maxConcurrent: 20,
        maxRevisions: 200,
        maxRequests24h: 20000,
        toolMemoryMb: 8192,
        toolTimeoutSeconds: 100000,
      }),
    );
  } finally {
    store.close();
  }
});

test('a plan over 100 tasks with a wide dependency join survives validation and backup history', () => {
  const state = initialState(true),
    project = state.projects[0];
  project.provider = 'ollama';
  project.model = 'fixture';
  const plan = Array.from({ length: 130 }, (_, i) => ({
    title: `Assignment ${i}`,
    description: 'Produce this specific useful result.',
    agentId: state.agents[0].id,
    dependencies: i === 129 ? Array.from({ length: 129 }, (_, j) => j) : [],
    requiresApproval: false,
    workType: 'plan',
  }));
  const checked = validatePlan(
    JSON.stringify({ tasks: plan }),
    project,
    state.agents,
    Number.MAX_SAFE_INTEGER,
  );
  assert.deepEqual(checked.issues, []);
  assert.equal(checked.tasks.length, 130);
  const ids = plan.map(() => randomUUID());
  state.tasks = plan.map((p, i) => ({
    ...p,
    workType: 'plan',
    id: ids[i],
    projectId: project.id,
    dependencies: p.dependencies.map((j) => ids[j]),
    status: 'queued',
    output: '',
    feedback: '',
  }));
  const backup = backupSchema.parse({
    format: 'workroom',
    version: 2,
    createdAt: Date.now(),
    state,
    attempts: [],
    planHistory: [
      { projectId: project.id, revision: 1, createdAt: Date.now(), tasks: state.tasks },
    ],
  });
  assert.equal(backup.planHistory?.[0].tasks.length, 130);
  assert.equal(backup.state.tasks[129].dependencies.length, 129);
});

test('tool execution has no fixed 16-action or 64-journal ceiling and compact finish metadata is filled by the app', async () => {
  const state = initialState(true),
    task = state.tasks[0];
  task.workType = 'plan';
  task.acceptanceCriteria = undefined;
  task.sandboxJournal = Array.from({ length: 65 }, () => ({
    id: randomUUID(),
    action: 'read',
    reference: 'read-file old.txt',
    status: 'completed',
    output: 'historical observation',
    exitCode: 0,
  }));
  let steps = 0;
  await runToolLoop(
    task,
    {},
    new AbortController().signal,
    { workspace: '/synthetic-fixture' },
    async (input) => {
      assert.equal((input.sandbox as any).remainingActionSlots, null);
      if (steps++ < 120) return JSON.stringify({ action: 'read', path: `file-${steps}.txt` });
      const value = result();
      return JSON.stringify({
        action: 'finish',
        result: { outcome: value.outcome, deliverable: value.deliverable, checks: value.checks },
      });
    },
    async () => ({ output: 'Synthetic read observation; not live model output.', exitCode: 0 }),
  );
  assert.equal(task.sandboxJournal.length, 185);
  assert.equal(task.observations?.length, 120);
  assert.equal(task.result?.outcome, 'complete');
  assert.ok(task.result?.summary);
});
