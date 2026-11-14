import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { managedInfo } from '../server/managed.js';
import { defaultPolicy, backupSchema } from '../shared/schemas.js';
import { workResultSchema, textWorkOutputSchema } from '../shared/work.js';
import { normalizeWorkReply } from '../server/work-results.js';
import { consoleReplyText } from '../src/console-view.js';
import type { ConsoleEntry } from '../shared/console.js';
import { result } from './work-fixtures.js';
import { initialState } from '../server/seed.js';
import { agentContext, workingStyle } from '../shared/agent-context.js';

test('fresh state has no mock project data and venture creativity does not invent tool capabilities', async () => {
  const state = initialState();
  for (const key of ['projects', 'tasks', 'approvals', 'activities'] as const)
    assert.deepEqual(state[key], []);
  assert.equal(state.provider, 'ollama');
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    const project = await engine.createProject(
      'Capital exploration',
      'Explore unconventional useful software solutions and ways to finance their validation.',
      'office',
      'manual',
      randomUUID(),
      'venture',
    );
    assert.equal(project.exploration, 'expansive');
    assert.equal(store.state.tasks.filter((task) => task.projectId === project.id).length, 0);
    const context = agentContext(project, project.team![0], { id: 'current', workType: 'plan' });
    assert.match(workingStyle(project), /challenge the initial plan/);
    assert.match(context.workStyle, /financing terms/);
    assert.equal(context.capabilities.fileEditing, false);
    assert.equal(context.capabilities.commands, false);
    assert.equal(context.capabilities.externalTransactions, false);
    const focused = await engine.createProject(
      'Focused capital comparison',
      project.brief,
      'office',
      'manual',
      randomUUID(),
      'venture',
      {
        reasoningEffort: 'medium',
        exploration: 'focused',
        meetingPolicy: { enabled: false, everyTasks: 3 },
      },
    );
    assert.equal(focused.exploration, 'focused', 'an explicit user preference wins');
  } finally {
    engine.stop();
    store.close();
  }
});

test('blank optional bullets are repaired without losing findings or laundering invalid outcomes', () => {
  const raw = result({
    handoff: {
      facts: ['Supplied prices', '', '  '],
      assumptions: ['Unknown demand', ''],
      next: 'Review.',
    },
  });
  const repaired = normalizeWorkReply(raw);
  assert.deepEqual(workResultSchema.parse(repaired.value).handoff, {
    facts: ['Supplied prices'],
    assumptions: ['Unknown demand'],
    next: 'Review.',
  });
  assert.equal(repaired.notes.length, 2);
  assert.equal(raw.handoff.facts.length, 3, 'the original provider reply must remain intact');
  const bad = workResultSchema.safeParse(normalizeWorkReply({ ...raw, outcome: 'continue' }).value);
  assert.equal(bad.success, false);
  if (!bad.success) {
    assert.deepEqual(bad.error.issues[0].path, ['followUps']);
    assert.match(bad.error.issues[0].message, /concrete specialist assignments/);
  }
  assert.equal(
    workResultSchema.safeParse(
      normalizeWorkReply(
        result({
          checks: [{ criterion: 'c1', status: 'unverified', evidence: 'Missing evidence' }],
        }),
      ).value,
    ).success,
    false,
  );
});

test('compact local replies retain actual work without requiring reporting filler or laundering completion', () => {
  const raw = {
    outcome: 'complete',
    deliverable: '$35 - $20 = $15.',
    checks: [
      { criterion: 'c1: Subtract prices', status: 'met', evidence: '35 - 20 = 15 dollars.' },
    ],
  };
  const normalized = normalizeWorkReply(raw, true);
  const accepted = workResultSchema.parse(normalized.value);
  assert.equal(accepted.summary, raw.deliverable);
  assert.equal(accepted.deliverable, raw.deliverable);
  assert.deepEqual(accepted.handoff.facts, []);
  assert.deepEqual(accepted.handoff.assumptions, []);
  assert.equal('summary' in raw, false);
  const schema = textWorkOutputSchema(true, ['atlas'], 2, true);
  const complete = schema.anyOf[0];
  assert.deepEqual(complete.required, ['outcome', 'deliverable', 'checks']);
  assert.equal(complete.properties.followUps, undefined);
  assert.equal(complete.properties.decision, undefined);
  assert.deepEqual(complete.properties.checks.items.properties.status.enum, ['met']);
  assert.deepEqual(Object.keys(complete.properties).slice(0, 3), [
    'outcome',
    'deliverable',
    'checks',
  ]);
  assert.equal(
    workResultSchema.safeParse(
      normalizeWorkReply({ ...raw, checks: [{ ...raw.checks[0], status: 'unverified' }] }, true)
        .value,
    ).success,
    false,
  );
  assert.equal(
    workResultSchema.safeParse(normalizeWorkReply({ ...raw, outcome: 'continue' }, true).value)
      .success,
    false,
  );
  assert.equal(
    workResultSchema.safeParse(normalizeWorkReply(raw).value).success,
    false,
    'other adapters retain their full result contract',
  );
  const retrieval = { outcome: 'retrieve', requests: [{ sourceId: 'task:known', offset: 0 }] };
  assert.deepEqual(normalizeWorkReply(retrieval, true).value, retrieval);
});

test('public streaming and finished console text retain the outcome, handoff, follow-ups and unknown fields', () => {
  const reply = JSON.stringify({
    ...result({
      outcome: 'continue',
      followUps: [
        {
          title: 'Check prices',
          description: 'Independently calculate the difference.',
          agentId: 'atlas',
        },
      ],
    }),
    diagnostic: 'public extra field',
  });
  const entry = { type: 'response', status: 'in_progress', text: reply } as ConsoleEntry;
  assert.equal(consoleReplyText(entry, false), reply);
  const completed = { ...entry, status: 'completed' };
  assert.deepEqual(JSON.parse(consoleReplyText(completed, false)), JSON.parse(reply));
  for (const key of [
    'outcome',
    'handoff',
    'facts',
    'assumptions',
    'next',
    'followUps',
    'diagnostic',
  ])
    assert.ok(consoleReplyText(completed, false).includes(`"${key}"`));
  assert.equal(consoleReplyText(completed, true), reply);
  assert.equal(consoleReplyText({ ...entry, text: reply.slice(0, -1) }, false), reply.slice(0, -1));
});

test('Ollama correction becomes real analyst and reviewer assignments whose results resume the coordinator', async () => {
  const oldFetch = globalThis.fetch,
    before = { ...managedInfo };
  const keys = ['AGENT_PROVIDER', 'WORKROOM_DEMO', 'OLLAMA_MODEL', 'OLLAMA_URL'];
  const saved = keys.map((key) => process.env[key]);
  process.env.AGENT_PROVIDER = 'ollama';
  delete process.env.WORKROOM_DEMO;
  process.env.OLLAMA_MODEL = 'offline-protocol-fixture';
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
  Object.assign(managedInfo, { ollamaReady: true, ollamaModels: ['offline-protocol-fixture'] });
  const store = new Store(':memory:'),
    engine = new Engine(store, 1);
  store.state.policy = { ...structuredClone(defaultPolicy), maxInputBytes: 50000 };
  const calls: { input: any; request: any }[] = [];
  try {
    const project = await engine.createProject(
      'Evidence handoff',
      'Compare supplied prices A $20 and B $35; independently check the arithmetic. Demand is unknown.',
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    const parent = store.state.tasks.find((task) => task.projectId === project.id)!;
    let parentTurns = 0;
    globalThis.fetch = (async (url, options) => {
      assert.match(String(url), /\/api\/chat$/, 'no API fallback');
      const request = JSON.parse(String(options?.body)),
        input = JSON.parse(request.messages[1].content);
      calls.push({ input, request });
      const actor = input.agentContext.agentId;
      assert.match(request.messages[0].content, new RegExp(`You are ${input.agentContext.name}`));
      assert.ok(input.agentContext.procedure);
      assert.ok(input.agentContext.workStyle);
      assert.match(
        request.messages[0].content,
        /agentContext\.procedure and agentContext\.workStyle/,
      );
      assert.equal(
        request.messages[0].content.includes(input.agentContext.procedure),
        false,
        'send the full specialist procedure once, leaving room for evidence',
      );
      assert.equal(
        request.messages[0].content.includes(input.agentContext.workStyle),
        false,
        'send the full creativity instructions once, leaving room for evidence',
      );
      const complete = request.format.anyOf.find((variant: any) =>
        variant.properties.outcome.enum?.includes('complete'),
      );
      const continuation = request.format.anyOf.find((variant: any) =>
        variant.properties.outcome.enum?.includes('continue'),
      );
      assert.equal(complete.properties.handoff, undefined, 'local grammar omits reporting filler');
      assert.deepEqual(complete.required, ['outcome', 'deliverable', 'checks']);
      let reply: unknown;
      if (actor === parent.agentId && parentTurns++ === 0) {
        reply = result({
          outcome: 'continue',
          deliverable: 'We will create a comparison later.',
          handoff: {
            facts: ['Supplied prices: A $20 and B $35.', ''],
            assumptions: [],
            next: 'Compare.',
          },
        });
      } else if (actor === parent.agentId && parentTurns === 2) {
        assert.match(input.validationIssues.join(' '), /followUps.*empty/);
        assert.equal(input.delegationState.maxFollowUpsThisTurn, 3);
        assert.deepEqual(
          continuation.properties.followUps.items.properties.agentId.enum,
          project.team!.map((agent) => agent.id),
        );
        reply = result({
          outcome: 'continue',
          deliverable:
            'Supplied inputs: A $20, B $35. Independent analysis and review are still needed.',
          followUps: [
            {
              title: 'Calculate the supplied difference',
              description: 'Compute the difference between $35 and $20 and label demand unknown.',
              agentId: 'atlas',
            },
            {
              title: 'Review the actual calculation',
              description:
                'Independently check the analyst arithmetic against the supplied prices and report any defects.',
              agentId: 'echo',
            },
          ],
        });
      } else {
        if (actor === 'atlas')
          assert.match(input.teammateOutputs[0].output, /Independent analysis/);
        if (actor === 'echo')
          assert.match(
            input.teammateOutputs.map((value: any) => value.output).join(' '),
            /Analyst finding: \$15/,
          );
        if (actor === parent.agentId) {
          assert.match(
            input.teammateOutputs.map((value: any) => value.output).join(' '),
            /Reviewer verified/,
          );
          assert.equal(input.delegationState.remainingCoordinationRounds, 0);
          assert.equal(continuation, undefined);
        }
        reply = result({
          deliverable:
            actor === 'atlas'
              ? 'Analyst finding: $15 difference, from $35 - $20. Demand remains unknown.'
              : actor === 'echo'
                ? 'Reviewer verified $35 - $20 = $15 against the supplied prices; no demand evidence was supplied.'
                : 'Final comparison: A saves $15. The analyst computed it and the reviewer independently checked it. No revenue or demand was verified.',
          checks: (input.task.acceptanceCriteria?.length
            ? input.task.acceptanceCriteria
            : [{ id: 'c1', description: 'Compare prices' }]
          ).map((criterion: any) => ({
            criterion: `${criterion.id}: ${criterion.description}`,
            status: 'met',
            evidence: '$35 - $20 = $15 using the supplied prices; no external actions.',
          })),
          handoff: {
            facts: ['Supplied prices are $20 and $35.', ''],
            assumptions: [],
            next: 'Use the checked comparison; validate demand separately.',
          },
        });
      }
      return Response.json({
        message: { content: JSON.stringify(reply) },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 100,
        eval_count: 120,
      });
    }) as typeof fetch;
    engine.start();
    engine.runProject(project.id);
    for (let i = 0; i < 1000 && !['completed', 'paused'].includes(project.status); i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(project.status, 'completed', parent.error);
    assert.deepEqual(
      calls.map(({ input }) => input.agentContext.agentId),
      ['mira', 'mira', 'atlas', 'echo', 'mira'],
    );
    assert.equal(store.state.approvals.length, 0);
    assert.equal(store.attempts().length, 5);
    assert.equal(parent.coordinationRounds, 1);
    assert.equal(
      store.state.tasks.filter((task) => task.projectId === project.id && task.status === 'done')
        .length,
      3,
    );
    assert.ok(backupSchema.safeParse(store.backup()).success);
    assert.ok(store.consoleEntries(project.id).some((entry) => entry.status === 'normalized'));
    assert.ok(
      store
        .consoleEntries(project.id)
        .some(
          (entry) =>
            entry.type === 'response' &&
            entry.text.includes('"facts":["Supplied prices are $20 and $35.",""]'),
        ),
    );
  } finally {
    engine.stop();
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.close();
    globalThis.fetch = oldFetch;
    Object.assign(managedInfo, before);
    keys.forEach((key, i) =>
      saved[i] === undefined ? delete process.env[key] : (process.env[key] = saved[i]),
    );
  }
});
// Explicit compatibility coverage for the earlier single-reply local protocol.
process.env.WORKROOM_OLLAMA_INTERACTION = 'structured';
