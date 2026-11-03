import { deliveryPlanIssues } from '../server/delivery-plan.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { defaultPolicy, backupSchema } from '../shared/schemas.js';
import { workspaceFolder, projectWorkspace, workspaceFile } from '../server/workspaces.js';
import { result } from './work-fixtures.js';
import { followUpSchema } from '../shared/work.js';
import { evidenceGaps, commandKind } from '../server/verification.js';
import { projectKnowledge, archivedSource } from '../server/knowledge.js';
import { runTask } from '../server/providers.js';
import type { Task } from '../shared/types.js';
import { retrieveSources } from '../server/context.js';

const brief =
  'Compare supplied costs A at $20 and B at $35. Label demand unknown; do not spend money.';
function fixture(respond?: (input: any) => any) {
  const env = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'offline-fixture';
  process.env.OPENAI_MODEL = 'audit-model';
  const directory = mkdtempSync(join(tmpdir(), 'workroom-repair-')),
    path = join(directory, 'state.sqlite'),
    store = new Store(path),
    engine = new Engine(store, 1, undefined, undefined, 10);
  store.state.provider = 'openai';
  store.state.policy = {
    ...structuredClone(defaultPolicy),
    allowPaid: true,
    maxInputBytes: 200000,
    maxRequests24h: 1000,
    rates: { openai: { model: 'audit-model', inputPerMillion: 0, outputPerMillion: 0 } },
  };
  const requests: any[] = [];
  globalThis.fetch = (async (_url, options) => {
    const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
    requests.push(input);
    const value =
      respond?.(input) ??
      (input.task
        ? result({
            checks:
              input.task.acceptanceCriteria?.map((c: any) => ({
                criterion: `${c.id}: ${c.description}`,
                status: 'met',
                evidence: '$35 minus $20 equals $15.',
              })) || result().checks,
          })
        : {
            tasks: [
              {
                title: 'Compare costs',
                description: 'Compute the difference. Acceptance: report $15.',
                agentId: 'mira',
                dependencies: [],
                requiresApproval: false,
                workType: 'plan',
                acceptanceCriteria: [
                  { id: 'c1', description: 'Calculate the difference.', evidence: 'report' },
                ],
              },
            ],
          });
    return Response.json({
      choices: [{ message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
  }) as typeof fetch;
  return {
    store,
    engine,
    path,
    directory,
    requests,
    create: (title = 'Audit case', planning: 'manual' | 'ai' = 'manual') =>
      engine.createProject(title, brief, 'office', planning, randomUUID(), 'office'),
    async close() {
      engine.stop();
      await new Promise((r) => setTimeout(r, 30));
      store.close();
      globalThis.fetch = oldFetch;
      for (const [key, value] of [
        ['OPENAI_API_KEY', env.key],
        ['OPENAI_MODEL', env.model],
      ])
        if (value === undefined) delete process.env[key!];
        else process.env[key!] = value;
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const row = (projectId: string, values: Partial<Task> = {}): Task => ({
  id: randomUUID(),
  projectId,
  title: 'Compare supplied costs',
  description: 'Calculate $35 minus $20; label demand unknown.',
  agentId: 'mira',
  dependencies: [],
  status: 'queued',
  requiresApproval: false,
  output: '',
  feedback: '',
  ...values,
});
async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('Expected saved state was not reached');
}

test('stale plan, team and policy edits cannot overwrite newer saves; plan history survives backup', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    h.engine.editPlan(p.id, [row(p.id)]);
    const stale = structuredClone(h.store.state.tasks.filter((t) => t.projectId === p.id)),
      revision = p.planRevision!;
    const added = row(p.id, { title: 'Important new requirement', agentId: 'atlas' });
    h.engine.editPlan(p.id, [...stale, added], undefined, undefined, revision);
    assert.throws(
      () => h.engine.editPlan(p.id, stale, undefined, undefined, revision),
      /changed since/,
    );
    assert.ok(h.store.state.tasks.some((task) => task.id === added.id));
    assert.ok(h.store.planVersions(p.id).some((version) => version.tasks.length === 2));
    const teamVersion = p.teamRevision || 0;
    h.engine.configureTeam(p.id, 4, p.team!, teamVersion);
    assert.throws(() => h.engine.configureTeam(p.id, 4, p.team!, teamVersion), /changed since/);
    h.engine.updatePolicy(h.store.state.policy, 0);
    assert.throws(() => h.engine.updatePolicy(h.store.state.policy, 0), /changed since/);
    const backup = h.store.backup();
    assert.ok(backupSchema.safeParse(backup).success);
    h.store.restore(backup);
    assert.ok(h.store.planVersions(p.id).some((version) => version.tasks.length === 2));
  } finally {
    await h.close();
  }
});

test('managed files keep their immutable folder identity across renames and reject a foreign identity', async () => {
  const h = fixture();
  try {
    const p = await h.create('Original name');
    p.workMode = 'workspace';
    p.workspaceFolder = workspaceFolder(p);
    const folder = projectWorkspace(h.path, p);
    writeFileSync(join(folder, 'app.js'), 'export const answer=42;');
    h.engine.updateProject(p.id, {
      title: 'A completely different name',
      brief: p.brief,
      expectedUpdatedAt: p.createdAt,
    });
    assert.equal(projectWorkspace(h.path, p), folder);
    assert.match(workspaceFile(folder, 'app.js').toString(), /42/);
    assert.throws(() => projectWorkspace(h.path, { ...p, id: randomUUID() }), /identity/);
  } finally {
    await h.close();
  }
});

test('delegated work preserves acceptance metadata, supplies legacy defaults and never widens capability', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    h.engine.editPlan(p.id, [row(p.id)]);
    const parent = h.store.state.tasks.find((t) => t.projectId === p.id)!;
    const follow = followUpSchema.parse({
      title: 'Check the arithmetic',
      description: 'Independently verify the $15 difference.',
      agentId: 'atlas',
      workType: 'plan',
      readOnly: true,
      acceptanceCriteria: [
        { id: 'price', description: 'Verify $35 minus $20 equals $15.', evidence: 'report' },
      ],
    });
    (h.engine as any).coordinate(parent, [follow]);
    const child = h.store.state.tasks.find((t) => t.requestedByTaskId === parent.id)!;
    assert.equal(child.workType, 'plan');
    assert.equal(child.readOnly, true);
    assert.equal(child.acceptanceCriteria![0].id, 'price');
    assert.throws(
      () =>
        (h.engine as any).coordinate(child, [
          { ...follow, workType: 'implementation', acceptanceCriteria: [] },
        ]),
      /unavailable/,
    );
  } finally {
    await h.close();
  }
});

test('help, listing, zero-test results and scratch changes cannot certify software verification', () => {
  for (const command of [
    'rg --version',
    'node --test --help',
    'pytest --collect-only',
    'npx playwright test --list',
    'rg --files',
    'git diff --stat',
  ])
    assert.equal(commandKind(command), undefined, command);
  assert.equal(commandKind('npm test'), 'verification');
  assert.equal(commandKind('cat app.ts'), 'inspection');
  const checks = result({
    checks: [{ criterion: 'c1: Run actual tests', status: 'met', evidence: 'node --test --help' }],
  });
  assert.ok(
    evidenceGaps(
      {
        workType: 'tests',
        acceptanceCriteria: [
          { id: 'c1', description: 'Run actual tests', evidence: 'verification' },
        ],
      },
      [{ id: 'help', kind: 'verification', reference: 'node --test --help', detail: 'Usage' }],
      checks,
    ).length,
  );
  assert.ok(
    evidenceGaps(
      { workType: 'tests' },
      [{ id: 'empty', kind: 'verification', reference: 'npm test', detail: '0 tests passed' }],
      result(),
    ).length,
  );
  assert.deepEqual(
    evidenceGaps(
      { workType: 'tests' },
      [{ id: 'ten', kind: 'verification', reference: 'npm test', detail: '10 tests passed' }],
      result(),
    ),
    [],
  );
  assert.ok(
    evidenceGaps(
      { workType: 'tests' },
      [{ id: 'zero', kind: 'verification', reference: 'node --test', detail: '# tests 0' }],
      result(),
    ).length,
  );
  assert.ok(
    evidenceGaps(
      { workType: 'implementation' },
      [
        { id: 'scratch', kind: 'artifact', reference: '.workroom-tmp/draft.js', detail: 'add' },
        { id: 'run', kind: 'verification', reference: 'npm test', detail: '4 tests passed' },
      ],
      result(),
    ).length,
  );
});

test('failed planning can recover on the same project after a real conversation reply', async () => {
  let plans = 0;
  const h = fixture((input) => (!input.task && plans++ < 2 ? { tasks: [] } : undefined));
  try {
    const p = await h.create('Retry after a question', 'ai');
    await until(() => p.planningStatus === 'failed');
    const message = h.engine.postProjectMessage(
      p.id,
      randomUUID(),
      'Explain the failure and keep my brief.',
      true,
    );
    await until(() => h.engine.task(message.responseTaskId!).status === 'done');
    h.engine.retryPlanning(p.id);
    await until(() => p.planningStatus === 'ready');
    assert.equal(
      h.store.state.tasks.filter((t) => t.projectId === p.id && !t.conversationMessageId).length,
      1,
    );
    assert.ok(h.store.state.projectMessages!.some((m) => m.id === message.id));
  } finally {
    await h.close();
  }
});

test('standing constraints and rejected routes survive recent windows; revocation is explicit and archives are scoped', async () => {
  const h = fixture();
  try {
    const p = await h.create(),
      other = await h.create('Another project');
    const first = h.engine.postProjectMessage(
      p.id,
      randomUUID(),
      'STANDING-ALPHA: use only existing free tools.',
      false,
      { kind: 'direction' },
    );
    for (let i = 0; i < 14; i++)
      h.engine.postProjectMessage(p.id, randomUUID(), `Later question ${i}`, false, {
        kind: 'question',
      });
    const secret = h.engine.postProjectMessage(
      other.id,
      randomUUID(),
      'OTHER-PROJECT-NOT-AVAILABLE',
      false,
    );
    for (let i = 0; i < 8; i++) {
      const idea = h.engine.addIdea(p.id, randomUUID(), {
        title: `Rejected route ${i}`,
        proposal: `REJECTED-${i}: an unsuitable route.`,
        rationale: 'No supporting evidence.',
        nextStep: 'Do not pursue it.',
      });
      h.engine.decideIdea(p.id, idea.id, 'rejected');
    }
    const t = row(p.id);
    await runTask('openai', p, t, p.team![0], [], new AbortController().signal, {
      store: h.store,
      project: p,
      task: t,
    });
    const input = h.requests.at(-1);
    assert.match(JSON.stringify(input.standingDirections), /STANDING-ALPHA/);
    assert.match(JSON.stringify(input.boardDecisions), /REJECTED-0/);
    assert.equal(archivedSource(h.store.state, p, `message:${secret.id}`), undefined);
    h.engine.setDirection(p.id, first.id, false);
    assert.equal(projectKnowledge(p, h.store.state).standingDirections.length, 0);
    const source = archivedSource(h.store.state, p, 'board-decisions')!;
    assert.match(
      retrieveSources([source], [{ sourceId: source.id, offset: 0, query: 'REJECTED-7' }], 200)[0]
        .text,
      /REJECTED-7/,
    );
    assert.equal(h.store.state.projectMessages!.find((m) => m.id === first.id)!.active, false);
  } finally {
    await h.close();
  }
});

test('a reused fresh run rebuilds the original plan instead of starting evidence-dependent internal children', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    h.engine.editPlan(p.id, [row(p.id, { documentKind: 'budget' })]);
    const parent = h.store.state.tasks.find((t) => t.projectId === p.id)!;
    parent.output = 'Intermediate draft that a reviewer needs.';
    (h.engine as any).coordinate(parent, [
      { title: 'Check draft', description: 'Inspect the requesting draft.', agentId: 'echo' },
    ]);
    const fresh = await h.engine.restartProject(p.id, randomUUID(), 'Fresh root plan', 'reuse');
    const tasks = h.store.state.tasks.filter((t) => t.projectId === fresh.id);
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0].dependencies, []);
    assert.equal(tasks[0].documentKind, 'budget');
    assert.equal(tasks[0].output, '');
    assert.equal(h.engine.task(parent.id).output, 'Intermediate draft that a reviewer needs.');
  } finally {
    await h.close();
  }
});

test('saving completed work keeps a completed project completed; new follow-up work can still run', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    h.engine.editPlan(p.id, [row(p.id)]);
    h.engine.runProject(p.id);
    await until(() => p.status === 'completed');
    const tasks = structuredClone(h.store.state.tasks.filter((t) => t.projectId === p.id));
    h.engine.editPlan(p.id, tasks);
    assert.equal(p.status, 'completed');
    assert.throws(() => h.engine.runProject(p.id), /complete/);
    assert.equal(h.requests.length, 1);
    h.engine.editPlan(p.id, [
      ...tasks,
      row(p.id, { agentId: 'atlas', dependencies: [tasks[0].id] }),
    ]);
    h.engine.runProject(p.id);
    await until(() => p.status === 'completed');
    assert.equal(h.requests.length, 2);
  } finally {
    await h.close();
  }
});

test('old uncertain usage stays actionable and full rolling totals are independent of receipt pagination', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    h.engine.editPlan(p.id, [row(p.id)]);
    const t = h.store.state.tasks.find((t) => t.projectId === p.id)!;
    t.status = 'failed';
    const old = randomUUID(),
      now = Date.now();
    h.store.putAttempt({
      id: old,
      projectId: p.id,
      taskId: t.id,
      provider: 'openai',
      phase: 'task',
      status: 'uncertain',
      createdAt: now - 10000,
      reservedUsd: 0.4,
    });
    for (let i = 0; i < 550; i++)
      h.store.putAttempt({
        id: randomUUID(),
        projectId: p.id,
        provider: 'openai',
        phase: 'task',
        status: 'completed',
        createdAt: now - i,
        reservedUsd: 0.1,
      });
    assert.equal(h.engine.bootstrap().usage!.requests24h, 551);
    assert.ok(h.engine.bootstrap().attempts!.some((a) => a.id === old));
    assert.equal(h.store.attemptsPage({ status: 'uncertain', projectId: p.id }).entries[0].id, old);
    assert.throws(() => h.engine.retryTask(t.id), /Acknowledge/);
    h.engine.acknowledge(old);
    assert.equal(h.store.hasUncertain('task_id', t.id), false);
    const seen = new Set<string>();
    let before: string | undefined;
    do {
      const page = h.store.attemptsPage({ before, limit: 50 });
      for (const entry of page.entries) {
        assert.ok(!seen.has(entry.id));
        seen.add(entry.id);
      }
      before = page.nextCursor || undefined;
    } while (before);
    assert.equal(seen.size, 551);
  } finally {
    await h.close();
  }
});

test('an approval and another project meeting do not block unrelated ready work', async () => {
  const h = fixture();
  try {
    const p = await h.create(),
      other = await h.create('Separate meeting');
    h.store.state.policy!.maxConcurrent = 2;
    h.engine.editPlan(p.id, [row(p.id), row(p.id, { agentId: 'atlas' })]);
    const [review, ready] = h.store.state.tasks.filter((t) => t.projectId === p.id);
    review.status = 'review';
    p.status = 'needs_input';
    assert.equal((h.engine as any).runnable(ready), true);
    h.engine.startMeeting(
      other.id,
      'Discuss the specific supplied evidence and compare alternatives.',
    );
    assert.equal((h.engine as any).runnable(ready), true);
    h.engine.updateAgent(
      'mira',
      { ...p.team![0], name: 'Independent project edit' },
      p.id,
      p.teamRevision || 0,
    );
    assert.equal(p.team![0].name, 'Independent project edit');
    const own = row(other.id);
    h.store.state.tasks.push(own);
    assert.equal((h.engine as any).runnable(own), false);
  } finally {
    await h.close();
  }
});

test('conversation and idea journals exceed previous limits, paginate, reopen and survive restore without inflating snapshots', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    h.store.state.projectMessages = Array.from({ length: 600 }, (_, i) => ({
      id: randomUUID(),
      projectId: p.id,
      content: `Saved message ${i}`,
      kind: 'question' as const,
      createdAt: i + 1,
    }));
    h.store.state.ideas = Array.from({ length: 600 }, (_, i) => ({
      id: randomUUID(),
      projectId: p.id,
      title: `Saved idea ${i}`,
      proposal: `Proposal ${i}`,
      rationale: 'A testable hypothesis.',
      nextStep: 'Check it.',
      createdBy: 'user' as const,
      status: 'proposed' as const,
      authorName: 'You',
      authorRole: 'Owner',
      createdAt: i + 1,
    }));
    h.engine.commit();
    h.engine.postProjectMessage(p.id, randomUUID(), 'Still able to save a new direction.', false);
    h.engine.addIdea(p.id, randomUUID(), {
      title: 'Another card',
      proposal: 'A new candidate.',
      rationale: 'Needs evidence.',
      nextStep: 'Investigate.',
    });
    assert.equal(h.engine.bootstrap().state.projectMessages!.length, 200);
    assert.equal(h.engine.bootstrap().state.ideas!.length, 200);
    const db = new DatabaseSync(h.path),
      payload = JSON.parse((db.prepare('SELECT payload FROM workspace').get() as any).payload);
    db.close();
    assert.deepEqual(payload.projectMessages, []);
    assert.deepEqual(payload.ideas, []);
    let before: string | undefined,
      count = 0;
    do {
      const page = h.store.historyPage('message', p.id, before);
      count += page.entries.length;
      before = page.nextCursor || undefined;
    } while (before);
    assert.equal(count, 601);
    const backup = h.store.backup();
    assert.ok(backupSchema.safeParse(backup).success);
    h.store.restore(backup);
    assert.equal(h.store.state.projectMessages!.length, 601);
    const reopened = new Store(h.path);
    assert.equal(reopened.state.projectMessages!.length, 601);
    assert.equal(reopened.state.ideas!.length, 601);
    reopened.close();
  } finally {
    await h.close();
  }
});

test('working-software plans require implementation, independent review and executed tests, while design-only remains available', () => {
  const implementation = {
    agentId: 'sol',
    workType: 'implementation' as const,
    dependencies: [],
    acceptanceCriteria: [
      { id: 'code', description: 'Implement behavior', evidence: 'artifact' as const },
      { id: 'verify', description: 'Verify behavior', evidence: 'verification' as const },
    ],
  };
  const review = {
    agentId: 'atlas',
    workType: 'review' as const,
    dependencies: [0],
    acceptanceCriteria: [
      {
        id: 'review',
        description: 'Inspect implementation independently',
        evidence: 'inspection' as const,
      },
    ],
  };
  const tests = {
    agentId: 'echo',
    workType: 'tests' as const,
    dependencies: [0],
    acceptanceCriteria: [
      { id: 'test', description: 'Run representative tests', evidence: 'verification' as const },
    ],
  };
  assert.deepEqual(
    deliveryPlanIssues({ deliveryMode: 'build' }, [implementation, review, tests]),
    [],
  );
  assert.ok(
    deliveryPlanIssues({ deliveryMode: 'build' }, [
      { ...review, workType: 'plan', dependencies: [] },
    ]).length,
  );
  assert.ok(
    deliveryPlanIssues({ deliveryMode: 'build' }, [
      implementation,
      { ...review, agentId: 'sol' },
      tests,
    ]).some((issue) => issue.includes('independent')),
  );
  assert.deepEqual(
    deliveryPlanIssues({ deliveryMode: 'design' }, [
      {
        agentId: 'mira',
        workType: 'plan',
        dependencies: [],
        acceptanceCriteria: [
          { id: 'design', description: 'Describe a practical approach', evidence: 'report' },
        ],
      },
    ]),
    [],
  );
  assert.ok(deliveryPlanIssues({ deliveryMode: 'design' }, [implementation]).length);
  assert.ok(
    deliveryPlanIssues({ deliveryMode: 'build' }, [
      implementation,
      review,
      tests,
      { ...implementation, agentId: 'echo' },
    ]).some((issue) => issue.includes('each implementation')),
  );
});

test('model meetings track actions as task checks, retain evidence, and invite only selected specialists', async () => {
  const h = fixture((input) =>
    input.meeting
      ? input.contributions.length === 2
        ? {
            decision: 'Use the supplied prices without inventing demand.',
            rationale: 'The comparison is possible without external action.',
            dissent: 'Buyer demand remains unknown.',
            evidenceGaps: 'No demand evidence was supplied.',
            actions: [
              {
                taskId: input.plannedWork[0].taskId,
                action:
                  'Report the $15 price difference and explicitly label demand as unverified.',
              },
            ],
          }
        : {
            proposal: 'Compare supplied prices first.',
            rationale: 'The figures can be checked.',
            objection: 'Price alone does not establish demand.',
            alternative: 'Keep demand unknown until evidence exists.',
            evidenceGaps: 'No buyer evidence.',
            nextAction: 'Report the supported comparison.',
          }
      : undefined,
  );
  try {
    const p = await h.create();
    h.engine.editPlan(p.id, [
      row(p.id, {
        workType: 'plan',
        acceptanceCriteria: [
          { id: 'cost', description: 'Calculate the price difference.', evidence: 'report' },
        ],
      }),
    ]);
    assert.throws(
      () =>
        h.engine.startMeeting(p.id, 'Compare supplied evidence carefully.', 'manual', [
          'mira',
          'mira',
        ]),
      /unique teammate/,
    );
    assert.throws(
      () =>
        h.engine.startMeeting(p.id, 'Compare supplied evidence carefully.', 'manual', ['unknown']),
      /unique teammate/,
    );
    const meeting = h.engine.startMeeting(p.id, 'Compare supplied evidence carefully.', 'manual', [
      'sol',
      'echo',
    ]);
    await until(() => meeting.status === 'completed');
    assert.deepEqual(
      meeting.participants.map((agent) => agent.id),
      ['sol', 'echo'],
    );
    assert.equal(meeting.contributions.length, 2);
    assert.equal(h.requests.length, 3, 'two contributions and one chair request');
    const task = h.store.state.tasks.find((task) => task.projectId === p.id)!;
    assert.equal(meeting.actions![0].status, 'assigned');
    assert.equal(meeting.actions![0].agentId, task.agentId);
    assert.ok(
      task.acceptanceCriteria!.some(
        (criterion) => criterion.id === meeting.actions![0].criterionId,
      ),
    );
    assert.ok(archivedSource(h.store.state, p, `meeting:${meeting.id}`));
    const fresh = await h.engine.restartProject(
      p.id,
      randomUUID(),
      'Reusable original plan',
      'reuse',
    );
    assert.deepEqual(
      h.store.state.tasks
        .find((task) => task.projectId === fresh.id)!
        .acceptanceCriteria!.map((c) => c.id),
      ['cost'],
    );
    h.engine.runProject(p.id);
    await until(() => p.status === 'completed');
    assert.equal(meeting.actions![0].status, 'addressed');
    assert.match(meeting.actions![0].evidence!, /15/);
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
  } finally {
    await h.close();
  }
});

test('model selection and team instructions have independent conflict revisions, including settings-only empty plans', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    const revision = p.instructionRevision || 0;
    h.engine.setProjectProvider(p.id, 'openai', 'audit-model', undefined, p.settingsRevision || 0);
    h.engine.updateInstructions(
      p.id,
      'Always distinguish supplied facts from unknown customer demand.',
      'Prevent unsupported demand claims.',
      revision,
    );
    assert.throws(
      () =>
        h.engine.updateInstructions(
          p.id,
          'Stale instructions must not silently replace saved direction.',
          'Stale instruction draft.',
          revision,
        ),
      /changed since/,
    );
    assert.match(p.instructionHistory!.at(-1)!.text, /supplied facts/);
    h.engine.configureCollaboration(
      p.id,
      { meetingPolicy: { enabled: false, everyTasks: 3 } },
      p.settingsRevision || 0,
    );
    assert.equal(h.store.state.tasks.filter((t) => t.projectId === p.id).length, 0);
  } finally {
    await h.close();
  }
});

test('restoring a backup invalidates open plan, team, model, instruction, policy and brief drafts', async () => {
  const h = fixture();
  try {
    const p = await h.create();
    h.engine.editPlan(p.id, [row(p.id)]);
    const rows = structuredClone(h.store.state.tasks),
      version = p.planRevision!,
      stamp = p.updatedAt || p.createdAt;
    const backup = h.store.backup();
    h.store.restore(backup);
    assert.throws(
      () => h.engine.editPlan(p.id, rows, undefined, undefined, version),
      /changed since/,
    );
    assert.throws(() => h.engine.configureTeam(p.id, 4, p.team!, 0), /changed since/);
    assert.throws(
      () => h.engine.setProjectProvider(p.id, 'openai', 'audit-model', undefined, 0),
      /changed since/,
    );
    assert.throws(
      () => h.engine.updateInstructions(p.id, 'Stale draft', 'Restore must invalidate it.', 0),
      /changed since/,
    );
    assert.throws(() => h.engine.updatePolicy(h.store.state.policy, 0), /changed since/);
    assert.throws(
      () =>
        h.engine.updateProject(p.id, {
          title: 'Stale title',
          brief: p.brief,
          expectedUpdatedAt: stamp,
        }),
      /changed/,
    );
  } finally {
    await h.close();
  }
});
