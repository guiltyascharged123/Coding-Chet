import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { defaultPolicy, backupSchema } from '../shared/schemas.js';
import {
  assembleContext,
  contextSources,
  retrieveSources,
  writeSourceBundle,
} from '../server/context.js';
import { workResultSchema } from '../shared/work.js';
import { planProject, runTask } from '../server/providers.js';
import { agents } from '../server/seed.js';
import { result } from './work-fixtures.js';
import { managedInfo } from '../server/managed.js';
import { projectWorkspace } from '../server/workspaces.js';

async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Timed out waiting for the work state');
}
function harness() {
  const oldFetch = globalThis.fetch,
    key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = 'fixture-only';
  process.env.OPENAI_MODEL = 'fixture-model';
  const store = new Store(':memory:'),
    engine = new Engine(store, 1);
  store.state.provider = 'openai';
  store.state.policy = {
    ...structuredClone(defaultPolicy),
    allowPaid: true,
    rates: { openai: { model: 'fixture-model', inputPerMillion: 0, outputPerMillion: 0 } },
  };
  return {
    store,
    engine,
    close() {
      engine.stop();
      store.close();
      globalThis.fetch = oldFetch;
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      if (model === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = model;
    },
  };
}
const response = (value: unknown) =>
  Response.json({
    choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }],
    usage: { prompt_tokens: 100, completion_tokens: 100 },
  });
const brief =
  'Compare supplied office costs: option A is $20 and option B is $35. Label unverified demand and do not spend money.';

test('large final-review context fits the byte budget, preserves required directions and retrieves saved Unicode passages', () => {
  const data = {
    project: { title: 'Review sales package', brief },
    task: {
      title: 'Hand off the package',
      description: 'Check the actual cost arithmetic and unsupported demand claims.',
      revisionFeedback: 'Do not propose generic copywriting.',
      previousOutput: 'Old draft '.repeat(8000),
    },
    teammateOutputs: Array.from({ length: 15 }, (_, i) => ({
      sourceId: `task:${i}`,
      title: `Source ${i}`,
      output:
        'Hypothesis, not a verified sale. 🧑🏽‍💻 '.repeat(2000) + 'Exact ending: $35 - $20 = $15.',
    })),
    humanDirection: [{ sourceId: 'approval:1', feedback: 'No spending or contacting people.' }],
  };
  const packed = assembleContext('Review supplied evidence; never invent revenue.', data, 24000),
    input = JSON.parse(packed.user);
  assert.ok(packed.report.originalBytes > 500000);
  assert.ok(packed.report.inputBytes <= 24000);
  assert.deepEqual(input.project, data.project);
  assert.equal(input.task.revisionFeedback, data.task.revisionFeedback);
  assert.equal(input.humanDirection[0].feedback, data.humanDirection[0].feedback);
  assert.equal(input.teammateOutputs[0].excerpt, true);
  const source = contextSources(data).find((s) => s.id === 'task:0')!,
    length = Array.from(source.text).length;
  const page = retrieveSources([source], [{ sourceId: source.id, offset: length - 28 }], 100)[0];
  assert.match(page.text, /\$35 - \$20 = \$15/);
  assert.equal(page.nextOffset, length);
  assert.ok(!page.text.includes('\uFFFD'));
  const index = retrieveSources(
    contextSources(data),
    [{ sourceId: 'source-index', offset: 0 }],
    4000,
  )[0];
  assert.match(index.text, /task:14 \| Source 14/);
  assert.ok(data.teammateOutputs[0].output.endsWith('Exact ending: $35 - $20 = $15.'));
  assert.throws(
    () => assembleContext('Rules', { project: { brief: 'Required '.repeat(1000) } }, 2000),
    /required instructions need at least/,
  );
});

test('a review can request the missing saved passage and finish without a human context-limit notice', async () => {
  const h = harness();
  let calls = 0;
  try {
    const project = await h.engine.createProject(
      'Grounded final review',
      brief,
      'office',
      'template',
      randomUUID(),
      'office',
    );
    const task = h.store.state.tasks.filter((t) => t.projectId === project.id).at(-1)!;
    const source = h.store.state.tasks.find((t) => t.projectId === project.id)!;
    source.output =
      'Unverified assumptions. '.repeat(8000) + 'Decisive evidence: $35 minus $20 equals $15.';
    source.status = 'done';
    const offset = Array.from(source.output).length - 41;
    globalThis.fetch = (async (_url, options) => {
      calls++;
      const request = JSON.parse(String(options?.body)),
        input = JSON.parse(request.messages[1].content);
      assert.ok(Buffer.byteLength(request.messages.map((m: any) => m.content).join('')) <= 24000);
      if (calls === 1) {
        assert.equal(input.teammateOutputs[0].excerpt, true);
        return response({
          outcome: 'retrieve',
          requests: [{ sourceId: `task:${source.id}`, offset }],
        });
      }
      assert.match(input.requestedSources[0].text, /\$35 minus \$20 equals \$15/);
      return response(result());
    }) as typeof fetch;
    const output = await runTask(
      'openai',
      project,
      task,
      agents[3],
      [source],
      new AbortController().signal,
      { store: h.store, project, task },
    );
    assert.equal(output, result().deliverable);
    assert.equal(calls, 2);
    assert.ok(h.store.attempts().every((a) => a.status === 'completed'));
    assert.match(task.toolLog![0].detail, /Reading saved evidence/);
    assert.equal(source.output.length > 100000, true);
  } finally {
    h.close();
  }
});

test('invalid prose is corrected once, never cached as a result, and provider failures are not automatically retried', async () => {
  const h = harness();
  let calls = 0;
  try {
    const project = await h.engine.createProject(
      'Checked result protocol',
      brief,
      'office',
      'template',
      randomUUID(),
      'office',
    );
    const task = h.store.state.tasks.find((t) => t.projectId === project.id)!;
    globalThis.fetch = (async () => {
      calls++;
      return response('The team is synergizing amazing progress.');
    }) as typeof fetch;
    await assert.rejects(
      () =>
        runTask('openai', project, task, agents[0], [], new AbortController().signal, {
          store: h.store,
          project,
          task,
        }),
      /usable, checked work result/,
    );
    assert.equal(calls, 2);
    assert.equal(task.result, undefined);
    assert.ok(h.store.attempts().every((a) => a.status === 'completed'));
    globalThis.fetch = (async () => {
      calls++;
      return response(result());
    }) as typeof fetch;
    assert.equal(
      await runTask('openai', project, task, agents[0], [], new AbortController().signal, {
        store: h.store,
        project,
        task,
      }),
      result().deliverable,
    );
    assert.equal(calls, 3, 'invalid responses were not cached');
    await runTask('openai', project, task, agents[0], [], new AbortController().signal, {
      store: h.store,
      project,
      task,
    });
    assert.equal(
      calls,
      3,
      'confirmed complete text result can be reused without another model call',
    );
    globalThis.fetch = (async () => {
      calls++;
      return new Response('private', { status: 503 });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        runTask('openai', project, task, agents[0], [], new AbortController().signal, {
          store: h.store,
          project,
          task,
          cache: false,
        }),
      /HTTP 503/,
    );
    assert.equal(calls, 4, 'uncertain generation was not replayed');
  } finally {
    h.close();
  }
});

test('agents schedule focused teammate work, consume its evidence and resume the original assignment without human review', async () => {
  const h = harness();
  const seen: string[] = [];
  try {
    const project = await h.engine.createProject(
      'Useful autonomous team',
      brief,
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    const original = h.store.state.tasks.find((t) => t.projectId === project.id)!;
    let originalTurns = 0;
    globalThis.fetch = (async (_url, options) => {
      const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
      seen.push(input.task.title);
      if (input.task.title === original.title && originalTurns++ === 0)
        return response(
          result({
            outcome: 'continue',
            checks: [
              {
                criterion: 'Independently check the supplied cost calculation',
                status: 'unverified',
                evidence: 'The analyst has not yet checked the arithmetic.',
              },
            ],
            followUps: [
              {
                title: 'Independently verify the cost comparison',
                description:
                  'Compute $35 minus $20. Acceptance: report the difference and do not invent demand evidence.',
                agentId: 'atlas',
              },
            ],
          }),
        );
      if (input.task.title === original.title)
        assert.match(input.teammateOutputs[0].output, /\$15/);
      return response(result());
    }) as typeof fetch;
    h.engine.start();
    h.engine.runProject(project.id);
    await until(() => project.status === 'completed');
    assert.deepEqual(seen, [
      original.title,
      'Independently verify the cost comparison',
      original.title,
    ]);
    assert.equal(h.store.state.approvals.filter((a) => a.projectId === project.id).length, 0);
    assert.equal(original.coordinationRounds, 1);
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
    assert.equal(h.store.attempts().length, 3);
  } finally {
    h.close();
  }
});

test('real human choices resume unfinished work and are passed back with provenance', async () => {
  const h = harness();
  let calls = 0;
  try {
    const project = await h.engine.createProject(
      'A real owner decision',
      brief,
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    const task = h.store.state.tasks.find((t) => t.projectId === project.id)!;
    const decision = {
      question: 'Which spending ceiling should guide the experiment?',
      why: 'Only the owner can authorize a budget; no spending will happen automatically.',
      options: ['Plan without spending', 'Plan within a $20 ceiling'],
      recommended: 'Plan without spending',
    };
    globalThis.fetch = (async (_url, options) => {
      calls++;
      const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
      if (calls === 1) return response(result({ outcome: 'needs_input', decision }));
      assert.match(input.humanDirection[0].feedback, /Plan within a \$20 ceiling/);
      return response(result());
    }) as typeof fetch;
    h.engine.start();
    h.engine.runProject(project.id);
    await until(() => project.status === 'needs_input');
    const approval = h.store.state.approvals.find((a) => a.projectId === project.id)!;
    assert.deepEqual(approval.decision, decision);
    assert.equal(task.status, 'review');
    assert.equal(approval.resumeTask, true);
    assert.throws(
      () => h.engine.review(approval.id, 'approve', '', 'A choice the agent did not offer'),
      /listed options/,
    );
    assert.equal(approval.status, 'pending');
    const feedback = 'Only prepare a plan. '.padEnd(4000, 'x');
    h.engine.review(approval.id, 'approve', feedback, 'Plan within a $20 ceiling');
    await until(() => project.status === 'completed');
    assert.equal(calls, 2);
    assert.equal(task.result?.outcome, 'complete');
    assert.ok(
      approval.feedback!.includes(feedback),
      'full-length feedback must survive the selected choice and question framing',
    );
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
  } finally {
    h.close();
  }
});

test('project model IDs and instruction versions are explicit, retained in backups and do not silently enable paid work', async () => {
  const h = harness();
  try {
    const project = await h.engine.createProject(
      'A configurable project',
      brief,
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    h.engine.setProjectProvider(project.id, 'openai', 'another-model');
    assert.equal(project.model, 'another-model');
    assert.throws(
      () => h.engine.setProjectProvider(project.id, 'openai', 'spaces not valid'),
      /exact model ID/,
    );
    h.engine.updateInstructions(
      project.id,
      'Always separate supplied facts from demand hypotheses.',
      'Correct unsupported claims',
    );
    h.engine.updateInstructions(
      project.id,
      'Show arithmetic and label all unverified demand.',
      'Improve the evidence standard',
    );
    assert.equal(project.instructionHistory?.length, 2);
    await assert.rejects(
      () =>
        runTask(
          'openai',
          project,
          h.store.state.tasks.find((t) => t.projectId === project.id)!,
          agents[0],
          [],
          new AbortController().signal,
          { store: h.store, project },
        ),
      /price estimate matching/,
    );
    h.engine.setProjectProvider(project.id, 'openai', 'fixture-model');
    globalThis.fetch = (async (_url, options) => {
      const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
      assert.equal(input.projectInstructions, project.instructionHistory!.at(-1)!.text);
      return response(result());
    }) as typeof fetch;
    await runTask(
      'openai',
      project,
      h.store.state.tasks.find((t) => t.projectId === project.id)!,
      agents[0],
      [],
      new AbortController().signal,
      { store: h.store, project },
    );
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
    h.store.restore(h.store.backup());
    assert.equal(
      h.store.state.projects.find((p) => p.id === project.id)!.instructionHistory!.length,
      2,
    );
    assert.equal(h.store.state.policy!.allowPaid, false);
    project.status = 'running';
    // Use restored state for mutation guards.
    const restored = h.engine.project(project.id);
    restored.status = 'running';
    assert.throws(
      () => h.engine.updateInstructions(restored.id, 'No changes', 'Running task'),
      /Pause/,
    );
    assert.throws(() => h.engine.setProjectProvider(restored.id, 'openai', 'other'), /Pause/);
  } finally {
    h.close();
  }
});

test('requesting changes to a decision does not record the recommended option as the user’s choice', async () => {
  const h = harness();
  try {
    const project = await h.engine.createProject(
      'Clarify the owner decision',
      brief,
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    globalThis.fetch = (async () =>
      response(
        result({
          outcome: 'needs_input',
          decision: {
            question: 'Which spending ceiling should guide the experiment?',
            why: 'The owner has not supplied a budget and only they can set a ceiling.',
            options: ['Plan without spending', 'Plan a $20 experiment'],
            recommended: 'Plan without spending',
          },
        }),
      )) as typeof fetch;
    h.engine.start();
    h.engine.runProject(project.id);
    await until(() => project.status === 'needs_input');
    h.engine.pauseProject(project.id);
    const approval = h.store.state.approvals.find((a) => a.projectId === project.id)!;
    h.engine.review(
      approval.id,
      'revise',
      'Explain why a budget matters before asking me to choose.',
    );
    assert.equal(approval.status, 'revision');
    assert.equal(approval.feedback, 'Explain why a budget matters before asking me to choose.');
    assert.ok(!approval.feedback.includes('Plan without spending'));
  } finally {
    h.close();
  }
});

test('completion cannot carry failed checks or unfinished internal work, and coding evidence bundles reject symlinks', () => {
  assert.equal(
    workResultSchema.safeParse(
      result({
        checks: [
          {
            criterion: 'Actual customers paid',
            status: 'unverified',
            evidence: 'No transactions occurred.',
          },
        ],
      }),
    ).success,
    false,
  );
  assert.equal(
    workResultSchema.safeParse(result({ outcome: 'needs_input', decision: null })).success,
    false,
  );
  const dir = mkdtempSync(join(tmpdir(), 'workroom-evidence-')),
    other = mkdtempSync(join(tmpdir(), 'workroom-other-'));
  try {
    const bundle = writeSourceBundle(dir, {
      teammateOutputs: [{ sourceId: 'task:1', output: 'Full source '.repeat(10000) }],
    });
    assert.equal(JSON.parse(readFileSync(bundle, 'utf8')).sources[0].text.length, 120000);
    rmSync(join(dir, '.workroom-context'), { recursive: true });
    symlinkSync(
      other,
      join(dir, '.workroom-context'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => writeSourceBundle(dir, {}), /safe directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('the AI planner can produce a useful internal plan without inventing a mandatory human gate', async () => {
  const h = harness();
  try {
    const project = await h.engine.createProject(
      'No unnecessary approval',
      brief,
      'office',
      'template',
      randomUUID(),
      'office',
    );
    globalThis.fetch = (async () =>
      response({
        tasks: [
          {
            title: 'Check the supplied arithmetic',
            description:
              'Compute the $15 difference and label the result using the supplied figures.',
            agentId: 'atlas',
            dependencies: [],
            requiresApproval: false,
          },
        ],
      })) as typeof fetch;
    const tasks = await planProject(project, project.team!, { store: h.store, project });
    assert.equal(tasks[0].requiresApproval, false);
  } finally {
    h.close();
  }
});

test('managed tools can be explicitly enabled for a non-software team without losing files when disabled', async () => {
  const h = harness(),
    ready = managedInfo.codexReady;
  let directory: string | undefined;
  managedInfo.codexReady = true;
  try {
    const project = await h.engine.createProject(
      'Venture building tools',
      brief,
      'office',
      'template',
      randomUUID(),
      'venture',
    );
    h.engine.setProjectProvider(project.id, 'codex', 'fixture-model', 'workspace');
    assert.equal(project.workflow, 'venture');
    assert.equal(project.workMode, 'workspace');
    assert.ok(project.workspaceFolder);
    directory = projectWorkspace(h.store.path, project);
    assert.throws(
      () => h.engine.setProjectProvider(project.id, 'openai', 'fixture-model'),
      /Managed project tools require Codex/,
    );
    assert.equal(project.provider, 'codex', 'rejected settings must be atomic');
    h.engine.setProjectProvider(project.id, 'openai', 'fixture-model', 'text');
    assert.equal(project.workMode, 'text');
    assert.equal(projectWorkspace(h.store.path, project), directory);
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
    managedInfo.codexReady = ready;
    h.close();
  }
});

test('bounded coordination refuses extra work without corrupting the saved task graph', async () => {
  const h = harness();
  try {
    h.store.state.policy!.maxTasks = 1;
    const project = await h.engine.createProject(
      'Bounded internal work',
      brief,
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    globalThis.fetch = (async () =>
      response(
        result({
          outcome: 'continue',
          followUps: [
            {
              title: 'Independently inspect the figures',
              description:
                'Check the arithmetic and identify unsupported claims before the parent task completes.',
              agentId: 'atlas',
            },
          ],
        }),
      )) as typeof fetch;
    h.engine.start();
    h.engine.runProject(project.id);
    await until(() =>
      h.store.state.tasks.some((t) => t.projectId === project.id && t.status === 'failed'),
    );
    const tasks = h.store.state.tasks.filter((t) => t.projectId === project.id);
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0].dependencies, []);
    assert.match(tasks[0].error!, /task limit/);
    assert.equal(tasks[0].result!.followUps.length, 1, 'proposed work is preserved for review');
    assert.equal(h.store.attempts().length, 1);
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
  } finally {
    h.close();
  }
});
