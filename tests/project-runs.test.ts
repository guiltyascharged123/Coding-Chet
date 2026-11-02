import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { defaultPolicy, backupSchema } from '../shared/schemas.js';
import { workspaceFolder, projectWorkspace } from '../server/workspaces.js';
import { result, meetingResult } from './work-fixtures.js';
import { runTask } from '../server/providers.js';
import type { Task } from '../shared/types.js';

const brief =
  'Compare supplied costs A at $20 and B at $35, with evidence. No transactions are authorized.';
function fixture(respond?: (input: any) => any) {
  const env = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'offline-fixture';
  process.env.OPENAI_MODEL = 'fixture-model';
  const directory = mkdtempSync(join(tmpdir(), 'workroom-runs-')),
    store = new Store(join(directory, 'state.sqlite')),
    engine = new Engine(store, 1, undefined, undefined, 1);
  store.state.provider = 'openai';
  store.state.policy = {
    ...structuredClone(defaultPolicy),
    allowPaid: true,
    rates: { openai: { model: 'fixture-model', inputPerMillion: 0, outputPerMillion: 0 } },
  };
  const requests: any[] = [];
  globalThis.fetch = (async (_url, options) => {
    const body = JSON.parse(String(options?.body)),
      input = JSON.parse(body.messages[1].content);
    requests.push(input);
    const value =
      respond?.(input) ??
      (input.task
        ? result()
        : {
            tasks: [
              {
                title: 'Compare supplied costs',
                description: 'Show the arithmetic; acceptance: $35 minus $20 equals $15.',
                agentId: 'mira',
                dependencies: [],
                requiresApproval: false,
              },
            ],
          });
    if (input.task?.acceptanceCriteria?.length && value.outcome === 'complete')
      value.checks = input.task.acceptanceCriteria.map((criterion: any) => ({
        criterion: `${criterion.id}: ${criterion.description}`,
        status: 'met',
        evidence: '$35 minus $20 equals $15; demand remains unverified.',
      }));
    return Response.json({
      choices: [{ message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100 },
    });
  }) as typeof fetch;
  return {
    store,
    engine,
    directory,
    requests,
    async close() {
      engine.stop();
      await new Promise((r) => setTimeout(r, 20));
      store.close();
      globalThis.fetch = oldFetch;
      if (env.key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = env.key;
      if (env.model === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = env.model;
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('Expected saved state was not reached');
}
function row(projectId: string) {
  return {
    id: randomUUID(),
    projectId,
    title: 'Compare supplied evidence',
    description: 'Show the $15 difference.',
    agentId: 'mira',
    dependencies: [] as string[],
    status: 'queued' as const,
    requiresApproval: false,
    output: '',
    feedback: '',
  };
}

test('fresh restart preserves the old run, creates independent task IDs and files, and deduplicates a lost response', async () => {
  const h = fixture();
  try {
    const project = await h.engine.createProject(
      'Saved source',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
    );
    const first = row(project.id),
      second = { ...row(project.id), dependencies: [first.id], agentId: 'echo' };
    h.engine.editPlan(project.id, [first, second]);
    const old = h.engine.task(first.id);
    old.status = 'done';
    old.output = 'Saved old findings';
    old.result = result();
    project.workMode = 'workspace';
    project.workspaceFolder = workspaceFolder(project);
    const previousFolder = projectWorkspace(h.store.path, project);
    writeFileSync(join(previousFolder, 'previous.txt'), 'Keep this file');
    const id = randomUUID();
    const [fresh, duplicate] = await Promise.all([
      h.engine.restartProject(project.id, id, 'Independent fresh run', 'reuse'),
      h.engine.restartProject(project.id, id, 'Independent fresh run', 'reuse'),
    ]);
    assert.equal(fresh.id, duplicate.id);
    assert.equal(h.store.state.projects.filter((p) => p.id === id).length, 1);
    assert.equal(fresh.restartedFrom, project.id);
    assert.equal(fresh.provider, 'openai');
    assert.equal(fresh.model, 'fixture-model');
    const copied = h.store.state.tasks.filter((t) => t.projectId === id);
    assert.equal(copied.length, 2);
    assert.ok(copied.every((t) => t.status === 'queued' && !t.output && !t.result && !t.attemptId));
    assert.deepEqual(copied[1].dependencies, [copied[0].id]);
    assert.notEqual(copied[0].id, first.id);
    assert.equal(h.engine.task(first.id).output, 'Saved old findings');
    assert.notEqual(fresh.workspaceFolder, project.workspaceFolder);
    assert.deepEqual(readdirSync(projectWorkspace(h.store.path, fresh)), []);
    assert.equal(h.requests.length, 0);
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
    await assert.rejects(
      () => h.engine.restartProject(project.id, id, 'Different name', 'reuse'),
      /restart ID/,
    );
  } finally {
    await h.close();
  }
});

test('new planning and a restart keep the exact selected model, team and workspace-wide request accounting', async () => {
  const h = fixture();
  try {
    const source = await h.engine.createProject(
      'Old work',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
      {
        reasoningEffort: 'high',
        meetingPolicy: { enabled: false, everyTasks: 3 },
        exploration: 'expansive',
        requestTimeoutSeconds: 1200,
      },
      12,
    );
    h.engine.editPlan(source.id, [row(source.id)]);
    h.engine.runProject(source.id);
    await until(() => source.status === 'completed');
    h.store.state.policy!.maxRequests24h = 2;
    const fresh = await h.engine.restartProject(source.id, randomUUID(), 'Replanned run', 'replan');
    await until(() => fresh.planningStatus === 'ready');
    assert.equal(fresh.officeCapacity, 12);
    assert.equal(fresh.team!.length, 12);
    assert.equal(fresh.exploration, 'expansive');
    assert.equal(fresh.requestTimeoutSeconds, 1200);
    assert.equal(h.store.attempts().length, 2);
    h.engine.runProject(fresh.id);
    await until(() => fresh.status === 'paused');
    assert.equal(h.requests.length, 2, 'restart must not erase rolling request usage');
    assert.match(
      h.store.state.tasks.find((t) => t.projectId === fresh.id)!.error!,
      /request limit/i,
    );
  } finally {
    await h.close();
  }
});

test('restart can replan for a smaller office while retaining the historical team and assignments', async () => {
  const h = fixture();
  try {
    const source = await h.engine.createProject(
      'Larger source',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
      undefined,
      12,
    );
    h.engine.editPlan(source.id, [{ ...row(source.id), agentId: source.team![11].id }]);
    await assert.rejects(
      () => h.engine.restartProject(source.id, randomUUID(), 'Invalid smaller reuse', 'reuse', 4),
      /smaller team/,
    );
    const id = randomUUID();
    const fresh = await h.engine.restartProject(source.id, id, 'Smaller fresh team', 'replan', 4);
    await until(() => fresh.planningStatus === 'ready');
    assert.equal(fresh.officeCapacity, 4);
    assert.equal(fresh.team!.length, 4);
    assert.equal(source.team!.length, 12);
    assert.equal(
      h.store.state.tasks.find((t) => t.projectId === source.id)!.agentId,
      source.team![11].id,
    );
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
    await assert.rejects(
      () => h.engine.restartProject(source.id, id, 'Smaller fresh team', 'replan', 8),
      /restart ID/,
    );
  } finally {
    await h.close();
  }
});

test('conversation specialists can delegate, read the requesting evidence and finish while unrelated plan work stays paused', async () => {
  let turns = 0;
  const h = fixture((input) => {
    if (!input.task) return undefined;
    turns++;
    return turns === 1
      ? result({
          outcome: 'continue',
          deliverable:
            'Partial finding: compare the supplied costs. The price difference needs an independent check.',
          followUps: [
            {
              title: 'Independently verify the price difference',
              description:
                'Read the coordinator finding, calculate $35 minus $20, and label demand unknown.',
              agentId: 'atlas',
            },
          ],
        })
      : result();
  });
  try {
    const project = await h.engine.createProject(
      'Scoped internal delegation',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
    );
    const main = row(project.id);
    h.engine.editPlan(project.id, [main]);
    h.engine.start();
    const message = h.engine.postProjectMessage(
      project.id,
      randomUUID(),
      'Independently check the price difference before answering.',
      true,
    );
    await until(() => h.engine.task(message.responseTaskId!).status === 'done');
    const child = h.store.state.tasks.find(
      (task) => task.requestedByTaskId === message.responseTaskId,
    )!;
    assert.equal(child.status, 'done');
    assert.equal(child.agentId, 'atlas');
    assert.equal(child.readOnly, true);
    assert.equal(child.conversationMessageId, message.id);
    assert.equal(project.status, 'paused');
    assert.equal(h.engine.task(main.id).status, 'queued');
    assert.equal(h.requests.length, 3);
    assert.ok(JSON.stringify(h.requests[1]).includes('Partial finding'));
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
    const fresh = await h.engine.restartProject(
      project.id,
      randomUUID(),
      'Reuse only main plan',
      'reuse',
    );
    assert.equal(h.store.state.tasks.filter((task) => task.projectId === fresh.id).length, 1);
  } finally {
    await h.close();
  }
});

test('a project conversation has a real coordinator reply while the main plan stays paused, with isolated context and idempotent sends', async () => {
  const h = fixture();
  try {
    const project = await h.engine.createProject(
      'One project',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
    );
    h.engine.editPlan(project.id, [row(project.id)]);
    const other = await h.engine.createProject(
      'Other project',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
    );
    h.engine.postProjectMessage(other.id, randomUUID(), 'OTHER-PROJECT-PRIVATE-DIRECTION', false);
    const messageId = randomUUID(),
      message = h.engine.postProjectMessage(
        project.id,
        messageId,
        'Explain the supported price difference.',
        true,
      );
    assert.equal(
      h.engine.postProjectMessage(project.id, messageId, message.content, true).id,
      messageId,
    );
    await until(() => h.engine.task(message.responseTaskId!).status === 'done');
    assert.equal(project.status, 'paused');
    assert.equal(
      h.store.state.tasks.find((t) => t.projectId === project.id && !t.conversationMessageId)!
        .status,
      'queued',
    );
    assert.equal(h.requests.length, 1);
    const input = h.requests[0];
    assert.equal(input.projectScope.projectId, project.id);
    assert.equal(input.agentContext.agentId, 'mira');
    assert.equal(input.agentContext.role, project.team![0].role);
    assert.match(input.agentContext.procedure, /Role procedure/);
    assert.equal(
      input.latestProjectDirection,
      undefined,
      'a question must not silently become standing instructions',
    );
    assert.match(input.task.description, /price difference/);
    assert.ok(!JSON.stringify(input).includes('OTHER-PROJECT-PRIVATE-DIRECTION'));
    const backup = h.store.backup();
    assert.ok(backupSchema.safeParse(backup).success);
    h.store.restore(backup);
    assert.equal(
      h.store.state.projectMessages!.find((m) => m.id === messageId)!.responseTaskId,
      message.responseTaskId,
    );
  } finally {
    await h.close();
  }
});

test('all model turns retain the requesting specialist identity and project scope during source retrieval', async () => {
  const h = fixture();
  try {
    const project = await h.engine.createProject(
      'Role continuity',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
      undefined,
      8,
    );
    const source = {
      ...row(project.id),
      status: 'done' as const,
      output: 'Supplied source '.repeat(2000),
    };
    const task: Task = {
      ...row(project.id),
      agentId: 'nova',
      workType: 'review' as const,
      dependencies: [source.id],
    };
    let calls = 0;
    globalThis.fetch = (async (_url, options) => {
      const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
      calls++;
      assert.equal(input.agentContext.projectId, project.id);
      assert.equal(input.agentContext.agentId, 'nova');
      assert.equal(input.agentContext.role, project.team![4].role);
      assert.equal(input.availableTeammates.length, 8);
      assert.match(input.agentContext.procedure, /Review independently/);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify(
                calls === 1
                  ? {
                      outcome: 'retrieve',
                      requests: [{ sourceId: `task:${source.id}`, offset: 9000 }],
                    }
                  : result(),
              ),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });
    }) as typeof fetch;
    await runTask(
      'openai',
      project,
      task,
      project.team![4],
      [source],
      new AbortController().signal,
      { store: h.store, project, task },
    );
    assert.equal(calls, 2);
    assert.equal(task.result?.outcome, 'complete');
  } finally {
    await h.close();
  }
});

test('model proposals become attributed board records and investigations use the chosen specialist without resuming unrelated work', async () => {
  const h = fixture();
  try {
    const project = await h.engine.createProject(
      'Useful idea board',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
    );
    h.engine.editPlan(project.id, [row(project.id)]);
    const proposal = {
      title: 'Compare recurring reporting costs',
      proposal: 'Test whether automating a recurring report removes measurable manual work.',
      rationale: 'Demand is unverified; measure saved time before assuming willingness to pay.',
      nextStep: 'Inspect a supplied example and define a falsifiable time-saving check.',
    };
    let calls = 0;
    globalThis.fetch = (async (_url, options) => {
      const input = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
      calls++;
      if (calls > 1) {
        assert.equal(input.agentContext.agentId, 'echo');
        assert.ok(input.ideaBoard.some((source: any) => source.title === proposal.title));
        assert.equal(
          input.latestProjectDirection,
          undefined,
          'an investigation is not a new standing instruction',
        );
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify(result({ ideas: [proposal] })) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });
    }) as typeof fetch;
    h.engine.runProject(project.id);
    await until(() => project.status === 'completed');
    const idea = h.store.state.ideas![0];
    assert.equal(idea.authorAgentId, 'mira');
    assert.equal(idea.createdBy, 'model');
    assert.ok(idea.sourceTaskId);
    assert.equal(idea.status, 'proposed');
    const investigation = h.engine.investigateIdea(project.id, idea.id, randomUUID(), 'echo');
    assert.equal(
      h.engine.investigateIdea(project.id, idea.id, randomUUID(), 'echo').id,
      investigation.id,
    );
    await until(() => investigation.status === 'done');
    assert.equal(idea.status, 'evaluated');
    assert.equal(idea.investigationTaskId, investigation.id);
    assert.equal(
      h.store.state.ideas!.length,
      1,
      'repeated model suggestions should not create duplicate board cards',
    );
    h.engine.decideIdea(project.id, idea.id, 'selected');
    assert.equal(idea.status, 'selected');
    const other = await h.engine.createProject(
      'Other board',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
    );
    assert.throws(() => h.engine.decideIdea(other.id, idea.id, 'selected'), /not found/);
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
  } finally {
    await h.close();
  }
});

test('an eight-specialist meeting produces actual role-scoped contributions and source-linked board proposals', async () => {
  const h = fixture();
  try {
    const project = await h.engine.createProject(
      'Real meeting board',
      brief,
      'office',
      'manual',
      randomUUID(),
      'office',
      undefined,
      8,
    );
    const seen: any[] = [];
    globalThis.fetch = (async (_url, options) => {
      const body = JSON.parse(String(options?.body)),
        input = JSON.parse(body.messages[1].content);
      seen.push(input);
      assert.equal(input.agentContext.phase, 'meeting');
      assert.equal(input.agentContext.projectId, project.id);
      assert.equal(input.agentContext.capabilities.commands, false);
      const value = meetingResult(
        input,
        body.messages[0].content.includes('Chair this team meeting'),
        `Proposal from ${input.agentContext.name}`,
      );
      return Response.json({
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });
    }) as typeof fetch;
    const meeting = h.engine.startMeeting(
      project.id,
      'Compare distinct approaches, challenge the evidence and assign useful next work.',
    );
    await until(() => meeting.status === 'completed');
    assert.equal(seen.length, 9);
    assert.equal(meeting.contributions.length, 8);
    assert.equal(h.store.state.ideas!.length, 8);
    assert.ok(
      h.store.state.ideas!.every(
        (idea) => idea.sourceMeetingId === meeting.id && idea.status === 'proposed',
      ),
    );
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
  } finally {
    await h.close();
  }
});
