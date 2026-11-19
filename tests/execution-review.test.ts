import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { initialState } from '../server/seed.js';
import { defaultPolicy } from '../shared/schemas.js';
import { runToolLoop } from '../server/tool-loop.js';
import { result } from './work-fixtures.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  runContainerProcess,
  type ContainerDriver,
  ContainerShutdownError,
} from '../server/container-sandbox.js';
import { Engine } from '../server/engine.js';
import { randomUUID } from 'node:crypto';

test('format corrections have per-response allowances and do not consume tool-action budgets', async () => {
  const store = new Store(':memory:');
  try {
    store.state.policy = { ...defaultPolicy, maxToolActions: 2, maxFormatCorrections: 1 };
    const task = initialState(true).tasks[0];
    task.workType = 'plan';
    task.acceptanceCriteria = [{ id: 'c1', description: 'Inspect notes', evidence: 'inspection' }];
    const replies = [
      'invalid JSON',
      JSON.stringify({ action: 'read', path: 'notes.txt' }),
      'another malformed response',
      JSON.stringify({ action: 'read', path: 'details.txt' }),
      JSON.stringify({ action: 'finish', result: result() }),
      JSON.stringify({
        action: 'finish',
        result: result({
          deliverable: 'Inspected notes.txt and details.txt using the fixture tool.',
          checks: [
            {
              criterion: 'c1: Inspect notes',
              status: 'met',
              evidence: 'read-file notes.txt returned the supplied file observation.',
            },
          ],
        }),
      }),
    ];
    let actions = 0;
    const slots: unknown[] = [];
    await runToolLoop(
      task,
      {},
      new AbortController().signal,
      { store, workspace: '/fixture' },
      async (input) => {
        slots.push((input.sandbox as any).remainingActionSlots);
        return replies.shift()!;
      },
      async () => {
        actions++;
        return { exitCode: 0, output: 'Synthetic file-read receipt; no live inference.' };
      },
    );
    assert.equal(actions, 2);
    assert.deepEqual(slots, [2, 2, 1, 1, 0, 0]);
    assert.equal(task.result?.outcome, 'complete');
  } finally {
    store.close();
  }
});

test('cancellation waits for shutdown confirmation and preserves uncertain action intent on cleanup failure', async () => {
  const controller = new AbortController(),
    task = initialState(true).tasks[0];
  let child: ChildProcessWithoutNullStreams | undefined;
  let announce!: () => void;
  const started = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const driver: ContainerDriver = {
    spawn: () => {
      child = spawn(
        process.execPath,
        ['-e', 'console.log("fixture ready");setInterval(()=>{},1000)'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      child.stdout.once('data', announce);
      return child;
    },
    remove: async () => {
      child!.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('Fixture Docker removal failed');
    },
  };
  try {
    const pending = runToolLoop(
      task,
      {},
      controller.signal,
      { workspace: '/fixture' },
      async () => JSON.stringify({ action: 'run', command: 'fixture-only waiting process' }),
      async () =>
        runContainerProcess('fixture', [], undefined, controller.signal, 0, false, driver),
    );
    const rejected = assert.rejects(pending, /shutdown could not be confirmed/);
    await started;
    controller.abort();
    await rejected;
    assert.equal(task.sandboxJournal?.[0].status, 'started');
    assert.match(task.sandboxJournal?.[0].output || '', /shutdown could not be confirmed/);
  } finally {
    controller.abort();
    child?.kill('SIGKILL');
  }
});

test('a deadline cannot report a stopped job when Docker removal fails', async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const driver: ContainerDriver = {
    spawn: () =>
      (child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })),
    remove: async () => {
      throw new Error('Fixture Docker removal failed');
    },
  };
  try {
    await assert.rejects(
      runContainerProcess(
        'fixture',
        [],
        undefined,
        new AbortController().signal,
        0.01,
        false,
        driver,
      ),
      /shutdown could not be confirmed/,
    );
  } finally {
    child?.kill('SIGKILL');
  }
});

test('the task board retains an unconfirmed-shutdown warning after cancellation', async () => {
  const before = process.env.WORKROOM_DEMO;
  process.env.WORKROOM_DEMO = '1';
  const store = new Store(':memory:');
  store.state = initialState(true);
  store.state.tasks = store.state.tasks.slice(0, 1);
  const engine = new Engine(store, 1, async (_provider, project, task) => {
    task.attemptId = randomUUID();
    engine.pauseProject(project.id);
    throw new ContainerShutdownError(new Error('Fixture cleanup failure'));
  });
  try {
    engine.start();
    engine.runProject(store.state.projects[0].id);
    for (let i = 0; i < 100 && !store.state.tasks[0].error?.includes('shutdown could not'); i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.match(store.state.tasks[0].error || '', /shutdown could not be confirmed/);
    assert.match(store.state.tasks[0].error || '', /may still be running/);
    assert.equal(store.state.tasks[0].recovery, undefined);
  } finally {
    engine.stop();
    store.close();
    if (before === undefined) delete process.env.WORKROOM_DEMO;
    else process.env.WORKROOM_DEMO = before;
  }
});
