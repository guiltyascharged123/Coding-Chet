import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { defaultPolicy, backupSchema } from '../shared/schemas.js';
import { meetingTurn, runTask } from '../server/providers.js';
import type { Meeting } from '../shared/types.js';

async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Timed out waiting for meeting state');
}
test('meeting contributions survive failure and retry; usage is counted and completed speakers are not repeated', async () => {
  const fetch = globalThis.fetch,
    key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'test-only';
  delete process.env.OPENAI_MODEL;
  const store = new Store(':memory:'),
    engine = new Engine(store, 1, runTask, meetingTurn, 0);
  let calls = 0;
  try {
    store.state.provider = 'openai';
    store.state.policy = {
      ...structuredClone(defaultPolicy),
      allowPaid: true,
      rates: { openai: { model: 'gpt-4.1-mini', inputPerMillion: 0, outputPerMillion: 0 } },
    };
    const project = await engine.createProject(
      'A defensible opportunity',
      'Compare realistic paths to profit. Budget and available time have not yet been supplied.',
      'office',
      'template',
      randomUUID(),
      'venture',
    );
    globalThis.fetch = (async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages[0].content, /ChatGPT|Codex/);
      assert.match(body.messages[0].content, /evidence|uncertainty/);
      if (calls === 3) return new Response('private provider body', { status: 503 });
      return Response.json({
        choices: [
          {
            message: {
              content: `## Public contribution ${calls}\n\nChallenge the buyer assumption. Compare alternatives and use a falsifiable test.`,
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 40 },
      });
    }) as typeof fetch;
    const meeting = engine.startMeeting(
      project.id,
      'Find a specific buyer advantage that survives competition from general AI tools.',
    );
    await until(() => meeting.status === 'failed');
    assert.equal(meeting.contributions.length, 2);
    assert.equal(calls, 3);
    assert.ok(store.attempts().every((a) => a.phase === 'meeting' && a.meetingId === meeting.id));
    assert.equal(store.attempts().filter((a) => a.status === 'uncertain').length, 1);
    assert.throws(() => engine.runProject(project.id), /failed meeting/);
    assert.throws(() => engine.retryMeeting(meeting.id), /Acknowledge uncertain/);
    engine.acknowledge(store.attempts().find((a) => a.status === 'uncertain')!.id);
    await new Promise((r) => setTimeout(r, 10));
    engine.retryMeeting(meeting.id);
    await until(() => meeting.status === 'completed');
    assert.equal(
      calls,
      6,
      'two completed contributions were retained; only remaining two and chair ran',
    );
    assert.equal(meeting.contributions.length, 4);
    assert.equal(new Set(meeting.contributions.map((c) => c.agentId)).size, 4);
    assert.match(meeting.summary, /Public contribution 6/);
    const backup = store.backup();
    assert.ok(backupSchema.safeParse(backup).success);
    store.restore(backup);
    store.state.policy!.allowPaid = true;
    assert.equal(store.state.meetings![0].summary, meeting.summary);
    const task = store.state.tasks.find((t) => t.projectId === project.id)!;
    store.state.approvals.push({
      id: randomUUID(),
      projectId: project.id,
      taskId: task.id,
      question: 'Is this direction useful?',
      status: 'approved',
      feedback: 'Do not propose undifferentiated copywriting; compare buyer alternatives.',
      createdAt: Date.now(),
    });
    globalThis.fetch = (async (_url, init) => {
      const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      assert.equal(input.teamDecisions[0].decisions, meeting.summary);
      assert.match(input.humanDirection[0].feedback, /undifferentiated copywriting/);
      return Response.json({
        choices: [{ message: { content: '# Work using the saved meeting decisions' } }],
      });
    }) as typeof fetch;
    await runTask('openai', project, task, project.team![0], [], new AbortController().signal, {
      store,
      project,
    });
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

test('automatic meetings run at kickoff and real task milestones, hold the queue, and respect explicit settings', async () => {
  const store = new Store(':memory:');
  const seen: number[] = [];
  const engine = new Engine(
    store,
    1,
    async (_provider, _project, task) => `# ${task.title}`,
    async (_project, meeting, _agent, summary) => {
      if (summary) seen.push(meeting.checkpoint);
      return summary
        ? '# Proposed decisions and assigned next actions'
        : '# A distinct proposal and objection';
    },
    0,
  );
  try {
    const project = await engine.createProject(
      'Milestone meetings',
      'Produce useful work and challenge assumptions at milestones.',
      'office',
      'template',
      randomUUID(),
      'office',
      { reasoningEffort: 'high', meetingPolicy: { enabled: true, everyTasks: 2 } },
    );
    engine.start();
    engine.runProject(project.id);
    assert.equal(
      store.state.tasks.filter((t) => t.status === 'working').length,
      0,
      'kickoff holds execution',
    );
    await until(() =>
      store.state.approvals.some((a) => a.projectId === project.id && a.status === 'pending'),
    );
    assert.deepEqual(seen, [0]);
    engine.review(store.state.approvals.find((a) => a.projectId === project.id)!.id, 'approve', '');
    await until(() => project.status === 'completed');
    assert.deepEqual(seen, [0, 2]);
    assert.equal(store.state.meetings!.length, 2);
    assert.equal(project.reasoningEffort, 'high');
    for (let i = 0; i < 5; i++) engine.tick();
    assert.equal(
      store.state.meetings!.length,
      2,
      'completed projects do not hold empty recurring meetings',
    );
  } finally {
    engine.stop();
    store.close();
  }
});

test('stopped or restored meetings keep drafts, do not replay automatically, and can be explicitly skipped', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(
    store,
    1,
    runTask,
    async (_p, _m, _a, _s, ctx) =>
      new Promise((_resolve, reject) =>
        ctx.signal!.addEventListener('abort', () => reject(new Error('cancelled'))),
      ),
    0,
  );
  try {
    const p = await engine.createProject(
      'Interrupted debate',
      'Use this saved project goal when the meeting is resumed.',
      'office',
      'template',
      randomUUID(),
      'research',
    );
    const meeting = engine.startMeeting(
      p.id,
      'Compare the strongest alternatives and record objections.',
    );
    await until(() => meeting.status === 'running');
    const snapshot = store.backup();
    engine.stopMeeting(meeting.id);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(meeting.status, 'failed');
    assert.throws(() => engine.runProject(p.id), /failed meeting/);
    store.restore(snapshot);
    const restored = store.state.meetings![0];
    assert.equal(restored.status, 'failed');
    assert.match(restored.error!, /interrupted/);
    engine.skipMeeting(restored.id);
    assert.equal(restored.status, 'cancelled');
    assert.equal(store.state.projects.find((x) => x.id === p.id)!.brief, p.brief);
  } finally {
    engine.stop();
    store.close();
  }
});

test('meeting request limits stop a discussion without inventing missing contributions', async () => {
  const store = new Store(':memory:'),
    fetch = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  const engine = new Engine(store, 1, runTask, meetingTurn, 0);
  try {
    store.state.provider = 'openai';
    store.state.policy = {
      ...structuredClone(defaultPolicy),
      maxRequests24h: 1,
      allowPaid: true,
      rates: { openai: { model: 'gpt-4.1-mini', inputPerMillion: 0, outputPerMillion: 0 } },
    };
    globalThis.fetch = (async () =>
      Response.json({
        choices: [{ message: { content: '# One real model response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      })) as typeof fetch;
    const p = await engine.createProject(
      'Limited meeting',
      'Discuss a useful project with a strict request allowance.',
      'office',
      'template',
      randomUUID(),
      'office',
    );
    const meeting = engine.startMeeting(
      p.id,
      'Compare options and stop if the request limit is reached.',
    );
    await until(() => meeting.status === 'failed');
    assert.equal(meeting.contributions.length, 1);
    assert.equal(meeting.summary, '');
    assert.match(meeting.error!, /request limit/);
    assert.equal(store.attempts().length, 1);
  } finally {
    engine.stop();
    store.close();
    globalThis.fetch = fetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});
