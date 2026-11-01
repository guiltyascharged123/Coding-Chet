import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeWork } from '../src/office/work.js';
import { agents, initialState } from '../server/seed.js';
import type { ConsoleEntry } from '../shared/console.js';
import { roleProcedure } from '../shared/role-protocol.js';

test('office work follows the current attempt, actual tools and saved states without making up progress', () => {
  const state = initialState(),
    project = { ...state.projects[0], team: agents, provider: 'codex' as const };
  const task = {
    ...state.tasks[0],
    agentId: agents[0].id,
    status: 'working' as const,
    startedAt: 100,
    attemptId: 'current',
  };
  const entry = (id: string, sequence: number, values: Partial<ConsoleEntry>): ConsoleEntry => ({
    id,
    sequence,
    projectId: project.id,
    taskId: task.id,
    agentId: task.agentId,
    phase: 'task',
    provider: 'codex',
    type: 'request',
    text: 'actual request',
    createdAt: 101,
    updatedAt: 102,
    attemptId: 'current',
    ...values,
  });
  const old = entry('old', 100, { attemptId: 'previous', type: 'command', text: '$ npm test' });
  assert.equal(officeWork(agents[0], project, [task], [old]).label, 'Preparing assignment');
  const current = entry('request', 1, {});
  assert.equal(officeWork(agents[0], project, [task], [old, current]).label, 'Codex processing');
  const tool = entry('command', 2, {
    type: 'command',
    text: '$ npm test\n2 passing',
    status: 'in_progress',
  });
  const running = officeWork(agents[0], project, [task], [current, tool]);
  assert.equal(running.label, 'Running command');
  assert.equal(running.animation, 'typing');
  assert.equal(running.detail, '$ npm test');
  for (const text of [
    '{"summary":{"invalid":"type"}}',
    '{"outcome":"retrieve","requests":[]}',
    '{"summary":"unfinished',
  ]) {
    const reply = officeWork(
      agents[0],
      project,
      [task],
      [entry('reply', 3, { type: 'response', text, status: 'in_progress' })],
    );
    assert.ok(
      !reply.detail.includes('{'),
      'structured transport should not become dashboard garble',
    );
    assert.match(reply.label, /Receiving reply/);
  }
  const review = officeWork(agents[0], project, [{ ...task, status: 'review' }], [current, tool]);
  assert.equal(review.active, false);
  assert.match(review.label, /your decision/);
  const failed = officeWork(
    agents[0],
    project,
    [{ ...task, status: 'failed', error: 'Missing evidence' }],
    [tool],
  );
  assert.equal(failed.active, false);
  assert.equal(failed.label, 'Needs attention');
  assert.equal(failed.detail, 'Missing evidence');
  const other = officeWork(agents[0], { ...project, id: 'other-project' }, [task], [tool]);
  assert.equal(other.active, false);
  assert.equal(other.entry, undefined);
});

test('role procedures distinguish implementation, independent review and commercial validation', () => {
  assert.match(
    roleProcedure({ role: 'Custom specialist' }, { workType: 'implementation' }),
    /Implement: inspect/,
  );
  assert.match(
    roleProcedure({ role: 'Custom specialist' }, { workType: 'review' }),
    /Review independently/,
  );
  assert.match(roleProcedure({ role: 'Commercial strategist' }), /falsifiable experiment/);
});

test('planning is visible for legacy teams and only the actual meeting contributor is marked active', () => {
  const state = initialState(),
    project = { ...state.projects[0], planningStatus: 'planning' as const, team: undefined };
  assert.equal(officeWork(agents[0], project, [], []).active, true);
  assert.equal(officeWork(agents[1], project, [], []).active, false);
  const meeting = {
    id: 'discussion',
    projectId: project.id,
    agenda: 'Compare the evidence',
    trigger: 'manual' as const,
    status: 'running' as const,
    checkpoint: 0,
    participants: agents,
    contributions: [],
    summary: '',
    speakerId: agents[1].id,
    createdAt: 1,
  };
  assert.equal(officeWork(agents[0], project, [], [], meeting).active, false);
  assert.match(officeWork(agents[0], project, [], [], meeting).label, /Listening/);
  assert.equal(officeWork(agents[1], project, [], [], meeting).active, true);
  assert.match(
    roleProcedure({ role: 'Quality & test engineer' }, { workType: 'tests' }),
    /Verify behavior/,
  );
});
