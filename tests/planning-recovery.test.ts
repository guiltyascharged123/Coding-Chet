import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { defaultPolicy, backupSchema } from '../shared/schemas.js';
import { DEFAULT_LOCAL_MODEL } from '../shared/defaults.js';
import { managedInfo } from '../server/managed.js';
import { planOutputSchema, validatePlan } from '../server/planning.js';
import { agents } from '../server/seed.js';

const longTitle =
  'Competitive and market research: competitor analysis, acquisition effort/cost, delivery cost, unit economics, time‑to‑first‑validation';
function plan(count = 1) {
  return {
    tasks: Array.from({ length: count }, (_, index) => ({
      title: index === 1 ? longTitle : `Useful assignment ${index + 1}`,
      description:
        'Compare the supplied alternatives, identify missing evidence and state a testable next step.',
      agentId: agents[index % 4].id,
      dependencies: index ? [index - 1] : [],
      requiresApproval: false,
      workType: 'plan',
      acceptanceCriteria: [
        {
          id: `c${index + 1}`,
          description: 'Provide the requested comparison with assumptions explicitly labeled.',
          evidence: 'report',
        },
      ],
    })),
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Planner did not reach its saved terminal state');
}
function fixture(reply: (input: any, call: number) => unknown) {
  const oldFetch = globalThis.fetch,
    oldManaged = { ...managedInfo };
  const names = ['AGENT_PROVIDER', 'WORKROOM_DEMO', 'OLLAMA_MODEL', 'OLLAMA_URL'];
  const saved = names.map((name) => process.env[name]);
  process.env.AGENT_PROVIDER = 'ollama';
  delete process.env.WORKROOM_DEMO;
  process.env.OLLAMA_MODEL = DEFAULT_LOCAL_MODEL;
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
  Object.assign(managedInfo, { ollamaReady: true, ollamaModels: [DEFAULT_LOCAL_MODEL] });
  const store = new Store(':memory:'),
    engine = new Engine(store, 1),
    requests: any[] = [],
    traces: string[] = [];
  store.state.policy = { ...structuredClone(defaultPolicy), maxInputBytes: 60000 };
  engine.on('console', (entry) => traces.push(entry.entry.text));
  globalThis.fetch = (async (url, init) => {
    assert.match(String(url), /\/api\/chat$/, 'No other provider or paid fallback is allowed');
    const request = JSON.parse(String(init?.body)),
      input = JSON.parse(request.messages[1].content);
    requests.push({ request, input });
    const output = reply(input, requests.length);
    if (output instanceof Error) throw output;
    return Response.json({
      message: { content: typeof output === 'string' ? output : JSON.stringify(output) },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 100,
      eval_count: 120,
    });
  }) as typeof fetch;
  return {
    store,
    engine,
    requests,
    traces,
    async create() {
      return engine.createProject(
        'Useful local planning',
        'Compare supplied options A at $20 and B at $35. Label demand unknown.',
        'office',
        'ai',
        randomUUID(),
        'venture',
      );
    },
    async close() {
      engine.stop();
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.close();
      globalThis.fetch = oldFetch;
      Object.assign(managedInfo, oldManaged);
      names.forEach((name, i) =>
        saved[i] === undefined ? delete process.env[name] : (process.env[name] = saved[i]),
      );
    },
  };
}

test('the reported 134-character title preserves all twelve assignments without another model request', async () => {
  assert.equal(longTitle.length, 134);
  const proposed = plan(12);
  proposed.tasks[11].dependencies = [7, 8];
  const h = fixture(() => proposed);
  try {
    const project = await h.create();
    await until(() => project.planningStatus === 'ready');
    assert.equal(h.requests.length, 1);
    const tasks = h.store.state.tasks.filter((task) => task.projectId === project.id);
    assert.equal(tasks.length, 12);
    assert.ok(tasks[1].title.length <= 100);
    assert.ok(tasks[1].description.includes(longTitle));
    assert.ok(tasks[1].description.includes(proposed.tasks[1].description));
    assert.deepEqual(tasks[1].acceptanceCriteria, proposed.tasks[1].acceptanceCriteria);
    assert.deepEqual(tasks[11].dependencies, [tasks[7].id, tasks[8].id]);
    assert.equal(project.planningIssue, undefined);
    const schema = h.requests[0].request.format.properties.tasks;
    assert.equal(schema.maxItems, 30);
    assert.equal(schema.items.properties.title.maxLength, 100);
    assert.deepEqual(
      schema.items.properties.agentId.enum,
      project.team!.map((agent) => agent.id),
    );
    assert.match(h.traces.join(' '), /complete original wording is preserved/);
  } finally {
    await h.close();
  }
});

test('invalid criteria get one same-model correction with the exact field error and rejected draft', async () => {
  const h = fixture((_input, call) => {
    const value = plan();
    if (call === 1) value.tasks[0].acceptanceCriteria[0].description = 'x'.repeat(301);
    return value;
  });
  try {
    const project = await h.create();
    await until(() => project.planningStatus === 'ready');
    assert.equal(h.requests.length, 2);
    const correction = h.requests[1].input;
    assert.match(
      correction.planningCorrection.issues[0],
      /Task 1.*acceptanceCriteria.0.description.*301/,
    );
    assert.ok(correction.recentWork[0].text.includes('x'.repeat(301)));
    assert.equal(h.store.attempts().length, 2);
    assert.ok(
      h.store
        .attempts()
        .every((attempt) => attempt.provider === 'ollama' && attempt.status === 'completed'),
    );
    assert.equal(project.planningIssue, undefined);
  } finally {
    await h.close();
  }
});

test('two rejected replies stop, retain actionable details through backup, and inform explicit retry', async () => {
  const h = fixture((_input, call) => {
    const value = plan();
    if (call <= 2) value.tasks[0].dependencies = [0];
    return value;
  });
  try {
    const project = await h.create();
    await until(() => project.planningStatus === 'failed');
    assert.equal(h.requests.length, 2);
    assert.equal(h.store.state.tasks.length, 0);
    assert.match(project.planningError!, /Task 1.*dependencies.*circular dependency/);
    assert.ok(project.planningIssue!.response.includes('dependencies'));
    const backup = h.store.backup();
    assert.ok(backupSchema.safeParse(backup).success);
    h.store.restore(backup);
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.engine.retryPlanning(project.id);
    await until(() => h.engine.project(project.id).planningStatus === 'ready');
    assert.equal(h.requests.length, 3);
    assert.match(h.requests[2].input.planningCorrection.issues[0], /dependencies/);
  } finally {
    await h.close();
  }
});

test('a changed brief starts from current scope rather than treating an old rejected plan as authority', async () => {
  const h = fixture((_input, call) => (call <= 2 ? { tasks: [] } : plan()));
  try {
    const project = await h.create();
    await until(() => project.planningStatus === 'failed');
    h.engine.updateProject(project.id, {
      title: project.title,
      brief: 'Compare the new supplied prices $50 and $80; keep unknowns explicit.',
      expectedUpdatedAt: project.updatedAt || project.createdAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.engine.retryPlanning(project.id);
    await until(() => project.planningStatus === 'ready');
    assert.equal(h.requests[2].input.planningCorrection, undefined);
    assert.match(h.requests[2].input.brief, /\$50/);
  } finally {
    await h.close();
  }
});

test('changed team instructions start fresh planning while retaining the rejected draft for inspection', async () => {
  const h = fixture((_input, call) => (call <= 2 ? { tasks: [] } : plan()));
  try {
    const project = await h.create();
    await until(() => project.planningStatus === 'failed');
    const rejected = project.planningIssue!.response;
    h.engine.updateInstructions(
      project.id,
      'Compare the supplied office prices; do not propose a delivery business.',
      'Correct the project approach before replanning.',
    );
    assert.equal(project.planningIssue!.response, rejected);
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.engine.retryPlanning(project.id);
    await until(() => project.planningStatus === 'ready');
    assert.equal(h.requests[2].input.planningCorrection, undefined);
    assert.match(h.requests[2].input.projectInstructions, /do not propose a delivery business/);
  } finally {
    await h.close();
  }
});

test('the correction respects the request ceiling and network errors never auto-retry', async () => {
  const h = fixture(() => ({ tasks: [] }));
  try {
    h.store.state.policy!.maxRequests24h = 1;
    const project = await h.create();
    await until(() => project.planningStatus === 'failed');
    assert.equal(h.requests.length, 1);
    assert.match(project.planningError!, /request limit/);
    assert.ok(project.planningIssue!.issues.length);
  } finally {
    await h.close();
  }
  const offline = fixture(() => new Error('Local service disconnected'));
  try {
    const project = await offline.create();
    await until(() => project.planningStatus === 'failed');
    assert.equal(offline.requests.length, 1);
    assert.match(project.planningError!, /disconnected/);
  } finally {
    await offline.close();
  }
});

test('validation never discards oversized requirements, invalid owners, dependencies or task limits', () => {
  const tooLong = plan();
  tooLong.tasks[0].title = longTitle;
  tooLong.tasks[0].description = 'x'.repeat(4000);
  const rejected = validatePlan(JSON.stringify(tooLong), {}, agents, 30);
  assert.match(rejected.issues[0], /title.*134/);
  assert.equal(rejected.normalizations.length, 0);
  const tooMany = plan(3);
  assert.match(validatePlan(JSON.stringify(tooMany), {}, agents, 2).issues[0], /limit is 2/);
  const wrong = plan();
  wrong.tasks[0].agentId = 'unknown';
  assert.match(validatePlan(JSON.stringify(wrong), {}, agents, 30).issues[0], /exact IDs/);
  const build = validatePlan(JSON.stringify(plan()), { deliveryMode: 'build' }, agents, 30);
  assert.match(build.issues.join(' '), /implementation/);
  const schema = planOutputSchema(agents.slice(0, 2), 1);
  assert.equal(schema.properties.tasks.maxItems, 1);
  assert.ok(validatePlan('not JSON', {}, agents, 30).issues.length);
});

test('automatic format correction controls allow zero or two repairs without hidden extra calls', async () => {
  for (const allowed of [0, 2]) {
    const h = fixture((_input, call) => {
      const value = plan();
      if (call <= 2) value.tasks[0].acceptanceCriteria[0].description = 'x'.repeat(301);
      return value;
    });
    try {
      h.store.state.policy!.maxFormatCorrections = allowed;
      const project = await h.create();
      await until(() => project.planningStatus !== 'planning');
      assert.equal(h.requests.length, allowed === 0 ? 1 : 3);
      assert.equal(project.planningStatus, allowed === 0 ? 'failed' : 'ready');
      if (!allowed) assert.match(project.planningError!, /0 configured format/);
    } finally {
      await h.close();
    }
  }
});
