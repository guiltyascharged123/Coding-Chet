process.env.WORKROOM_DEMO = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';

async function until(engine: Engine, predicate: () => boolean) {
  for (let attempt = 0; attempt < 500; attempt++) {
    engine.tick();
    if (predicate()) return;
    await delay(5);
  }
  throw new Error('The expected runtime state was not reached.');
}

test('task dependencies, human revision, approval, and final handoff work end to end', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, 20);
  try {
    const project = engine.state.projects[0];
    const tasks = engine.state.tasks;
    engine.runProject(project.id);
    assert.equal(tasks[0].status, 'working');
    assert.ok(tasks.slice(1).every((t) => t.status === 'queued'));
    await until(engine, () => project.status === 'needs_input');
    assert.equal(tasks[0].status, 'done');
    assert.equal(tasks[1].status, 'review');
    assert.ok(tasks.slice(2).every((t) => t.status === 'queued'));
    const firstReview = engine.state.approvals.find((a) => a.status === 'pending')!;
    assert.throws(() => engine.review(firstReview.id, 'revise', ''), /what you would like changed/);
    engine.review(
      firstReview.id,
      'revise',
      'Use a bolder accent while keeping the layout accessible.',
    );
    await until(engine, () => project.status === 'needs_input');
    assert.match(tasks[1].output, /Use a bolder accent/);
    const nextReview = engine.state.approvals.find((a) => a.status === 'pending')!;
    assert.notEqual(firstReview.id, nextReview.id);
    assert.throws(() => engine.review(nextReview.id, 'revise', 'Try once more.'), /revision limit/);
    assert.equal(nextReview.status, 'pending');
    engine.review(nextReview.id, 'approve', 'This direction works.');
    assert.throws(() => engine.review(nextReview.id, 'approve', ''), /already been resolved/);
    await until(engine, () => project.status === 'completed');
    assert.ok(tasks.every((t) => t.status === 'done' && t.output.length > 500));
    assert.equal(engine.state.approvals.filter((a) => a.status === 'pending').length, 0);
    assert.ok(engine.state.activities.some((a) => a.targetAgentId && a.type === 'completed'));
  } finally {
    engine.stop();
    await delay(25);
    store.close();
  }
});

test('pause cancels in-flight work and resumes without losing the queue', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, 60);
  try {
    const project = engine.state.projects[0];
    engine.runProject(project.id);
    engine.pauseProject(project.id);
    assert.equal(project.status, 'paused');
    assert.equal(engine.state.tasks[0].status, 'queued');
    await delay(80);
    assert.equal(engine.state.tasks[0].output, '');
    engine.runProject(project.id);
    await until(engine, () => engine.state.tasks[0].status === 'done');
    assert.ok(engine.state.tasks[0].output);
  } finally {
    engine.stop();
    await delay(25);
    store.close();
  }
});

test('an agent is not scheduled for two simultaneous projects', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, 50);
  try {
    const firstId = engine.state.projects[0].id;
    const second = await engine.createProject(
      'Another idea',
      'Make a useful open source tool for independent creatives.',
    );
    engine.runProject(firstId);
    engine.runProject(second.id);
    const working = engine.state.tasks.filter((t) => t.status === 'working');
    assert.equal(new Set(working.map((t) => t.agentId)).size, working.length);
    assert.equal(working.length, 1);
  } finally {
    engine.stop();
    await delay(25);
    store.close();
  }
});

test('external leases stop uncertain work and require acknowledgment before retry', () => {
  const previous = process.env.RUNNER_TOKEN;
  process.env.RUNNER_TOKEN = 'test-runner-token-not-a-real-secret';
  const store = new Store(':memory:');
  const engine = new Engine(store);
  try {
    engine.setProvider('external');
    engine.setProjectProvider(engine.state.projects[0].id, 'external');
    engine.runProject(engine.state.projects[0].id);
    const assignment = engine.claim('mira')!;
    assert.ok(assignment.task.leaseId);
    assert.throws(
      () => engine.workerComplete(assignment.task.id, 'wrong-lease', 'Draft'),
      /expired or no longer active/,
    );
    engine.state.tasks[0].leaseExpiresAt = Date.now() - 10;
    engine.tick();
    assert.equal(engine.claim('mira'), null);
    assert.equal(engine.state.tasks[0].status, 'failed');
    assert.throws(() => engine.retryTask(assignment.task.id), /Acknowledge/);
    engine.acknowledge(engine.store.attempts().find((a) => a.taskId === assignment.task.id)!.id);
    engine.retryTask(assignment.task.id);
    const second = engine.claim('mira')!;
    assert.notEqual(second.task.leaseId, assignment.task.leaseId);
    engine.workerEvent(second.task.id, second.task.leaseId!, 'Inspecting the shared context.');
    engine.workerFail(second.task.id, second.task.leaseId!, 'A temporary worker failure.');
    assert.equal(engine.state.projects[0].status, 'paused');
    engine.acknowledge(
      engine.store.attempts().find((a) => a.taskId === second.task.id && a.status === 'uncertain')!
        .id,
    );
    engine.retryTask(second.task.id);
    const third = engine.claim('mira')!;
    engine.workerComplete(third.task.id, third.task.leaseId!, '# A real external deliverable');
    assert.equal(engine.state.tasks[0].status, 'done');
    assert.equal(engine.state.tasks[0].output, '# A real external deliverable');
  } finally {
    engine.stop();
    store.close();
    if (previous === undefined) delete process.env.RUNNER_TOKEN;
    else process.env.RUNNER_TOKEN = previous;
  }
});

test('SQLite preserves work and safely recovers interrupted tasks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-test-'));
  const path = join(directory, 'state.sqlite');
  let store = new Store(path);
  try {
    store.state.projects[0].status = 'running';
    store.state.tasks[0].status = 'done';
    store.state.tasks[0].output = 'Saved deliverable';
    store.state.tasks[1].status = 'working';
    store.save();
    store.close();
    store = new Store(path);
    assert.equal(store.state.projects[0].status, 'paused');
    assert.equal(store.state.tasks[0].output, 'Saved deliverable');
    assert.equal(store.state.tasks[1].status, 'queued');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('desk changes swap occupants and persist role assignments', () => {
  const store = new Store(':memory:');
  const engine = new Engine(store);
  try {
    engine.updateAgent('mira', {
      name: 'Nova',
      role: 'Research lead',
      specialty: 'Investigate evidence and explain uncertainty.',
      desk: 1,
    });
    assert.equal(engine.state.agents.find((a) => a.id === 'mira')?.desk, 1);
    assert.equal(engine.state.agents.find((a) => a.id === 'sol')?.desk, 0);
    assert.equal(engine.state.agents.find((a) => a.id === 'mira')?.role, 'Research lead');
  } finally {
    engine.stop();
    store.close();
  }
});
