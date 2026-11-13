import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, agents } from '../server/seed.js';
import type { Bootstrap, Attempt } from '../shared/types.js';
import type { ConsoleEntry } from '../shared/console.js';
import { modelJobs } from '../src/model-work.js';
function fixture() {
  const state = initialState(true);
  const project = {
    ...state.projects[0],
    team: structuredClone(agents),
    provider: 'ollama' as const,
    model: 'local-fixture',
    planningStatus: 'planning' as const,
    planningStartedAt: 1000,
  };
  state.projects = [project];
  state.tasks = [];
  return {
    project,
    data: { state, runtime: {} as Bootstrap['runtime'], attempts: [] } as Bootstrap,
  };
}
const event = (
  projectId: string,
  sequence: number,
  values: Partial<ConsoleEntry> = {},
): ConsoleEntry => ({
  id: `entry-${sequence}`,
  sequence,
  projectId,
  phase: 'plan',
  type: 'status',
  provider: 'ollama',
  model: 'local-fixture',
  text: 'Actual public event',
  createdAt: 1000 + sequence,
  updatedAt: 1000 + sequence,
  ...values,
});
const receipt = (projectId: string, values: Partial<Attempt> = {}): Attempt => ({
  id: 'first',
  projectId,
  provider: 'ollama',
  phase: 'plan',
  status: 'running',
  createdAt: 1001,
  reservedUsd: 0,
  ...values,
});

test('model status distinguishes waiting, received text, validation, and plan acceptance without leaking request content', () => {
  const { data, project } = fixture();
  data.attempts = [receipt(project.id)];
  const request = event(project.id, 1, {
    type: 'request',
    attemptId: 'first',
    text: 'PRIVATE REQUEST CONTENT',
    progress: {
      stage: 'waiting',
      inputBytes: 1200,
      contextLimitBytes: 24000,
      timeoutSeconds: 900,
      purpose: 'initial',
    },
  });
  let job = modelJobs(data, project.id, [request])[0];
  assert.equal(job.active, true);
  assert.equal(job.label, 'Waiting for public model output');
  assert.equal(job.actor, agents[0].name);
  assert.equal(job.metrics!.inputBytes, 1200);
  assert.ok(!JSON.stringify(job).includes('PRIVATE REQUEST CONTENT'));
  assert.equal(job.characters, undefined);
  const stream = event(project.id, 2, {
    type: 'response',
    attemptId: 'first',
    status: 'in_progress',
    text: 'First words',
    progress: { stage: 'streaming', receivedCharacters: 11 },
  });
  job = modelJobs(data, project.id, [request, stream])[0];
  assert.equal(job.label, 'Receiving public reply');
  assert.equal(job.characters, 11);
  const checked = event(project.id, 3, {
    attemptId: 'first',
    status: 'completed',
    progress: { stage: 'validating', receivedCharacters: 100 },
  });
  job = modelJobs(data, project.id, [request, stream, checked])[0];
  assert.equal(job.label, 'Checking the model reply');
  assert.equal(job.active, true, 'a provider receipt does not accept a plan');
  project.planningStatus = 'ready' as any;
  data.attempts![0].status = 'completed';
  job = modelJobs(data, project.id, [request, stream, checked])[0];
  assert.equal(job.active, false);
  assert.equal(job.label, 'Plan saved');
});

test('a correction has its own timer and received-character count, and prior runs/projects cannot impersonate current progress', () => {
  const { data, project } = fixture();
  data.attempts = [
    receipt(project.id, { status: 'completed' }),
    receipt(project.id, { id: 'second', createdAt: 1010 }),
  ];
  const first = event(project.id, 2, {
    type: 'response',
    attemptId: 'first',
    status: 'completed',
    progress: { stage: 'validating', receivedCharacters: 999 },
  });
  const second = event(project.id, 11, {
    type: 'request',
    attemptId: 'second',
    progress: { stage: 'waiting', purpose: 'correction' },
  });
  let job = modelJobs(data, project.id, [
    first,
    second,
    event('other-project', 100, { text: 'Other project content' }),
  ])[0];
  assert.equal(job.purpose, 'correction');
  assert.equal(job.requestAt, 1010);
  assert.equal(job.characters, undefined);
  assert.ok(!JSON.stringify(job).includes('Other project content'));
  project.planningStartedAt = 5000;
  job = modelJobs(data, project.id, [first, second])[0];
  assert.equal(job.requestAt, undefined);
  assert.equal(job.label, 'Preparing request');
});

test('queued dependencies and external workers are reported without pretending a model is running', () => {
  const { data, project } = fixture();
  project.planningStatus = 'ready' as any;
  project.status = 'running';
  const first = {
    id: 'one',
    projectId: project.id,
    title: 'Required review',
    description: 'Inspect supplied evidence.',
    agentId: 'atlas',
    dependencies: [],
    status: 'review' as const,
    requiresApproval: true,
    output: 'Review',
    feedback: '',
  };
  data.state.tasks = [
    first,
    {
      ...first,
      id: 'two',
      agentId: 'mira',
      title: 'Follow-up work',
      dependencies: ['one'],
      status: 'queued',
      requiresApproval: false,
    },
  ];
  let job = modelJobs(data, project.id, [])[0];
  assert.equal(job.active, false);
  assert.equal(job.label, 'Waiting for required teammate work');
  assert.match(job.detail, /Required review \(review\)/);
  assert.equal(job.requestAt, undefined);
  data.state.tasks[1].status = 'working';
  data.state.tasks[1].startedAt = 1000;
  project.provider = 'external' as any;
  job = modelJobs(data, project.id, [])[0];
  assert.equal(job.label, 'External worker has the assignment');
  assert.match(job.detail, /cannot confirm/);
});
