import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { runTask } from '../server/providers.js';
import { managedInfo } from '../server/managed.js';
import { backupSchema } from '../shared/schemas.js';
import { archivedSource } from '../server/knowledge.js';
import type { Task } from '../shared/types.js';

async function fixture() {
  const names = ['AGENT_PROVIDER', 'OLLAMA_MODEL', 'OLLAMA_URL', 'WORKROOM_OLLAMA_INTERACTION'];
  const previous = names.map((name) => process.env[name]),
    info = { ...managedInfo },
    originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    AGENT_PROVIDER: 'ollama',
    OLLAMA_MODEL: 'artifact-fixture-not-live',
    OLLAMA_URL: 'http://127.0.0.1:11434',
    WORKROOM_OLLAMA_INTERACTION: 'artifact-first',
  });
  Object.assign(managedInfo, { ollamaReady: true, ollamaModels: ['artifact-fixture-not-live'] });
  const root = mkdtempSync(join(tmpdir(), 'workroom-artifact-')),
    path = join(root, 'workspace.sqlite');
  let store = new Store(path),
    engine = new Engine(store);
  const project = await engine.createProject(
    'Artifact recovery',
    'A = $20 and B = $35. Compare the supplied prices only.',
    'office',
    'manual',
    randomUUID(),
    'custom',
  );
  project.model = 'artifact-fixture-not-live';
  const task: Task = {
    id: randomUUID(),
    projectId: project.id,
    title: 'Subtract prices',
    description: 'A = $20; B = $35. Compute B minus A.',
    agentId: project.team![0].id,
    dependencies: [],
    status: 'working',
    requiresApproval: false,
    output: '',
    feedback: '',
    workType: 'plan',
    acceptanceCriteria: [
      { id: 'c1', description: 'Compute the price difference', evidence: 'report' },
    ],
  };
  store.state.tasks.push(task);
  store.save();
  return {
    get store() {
      return store;
    },
    get engine() {
      return engine;
    },
    get project() {
      return engine.project(project.id);
    },
    get task() {
      return engine.task(task.id);
    },
    async run() {
      return runTask(
        'ollama',
        this.project,
        this.task,
        this.project.team![0],
        [],
        new AbortController().signal,
        {
          store,
          project: this.project,
          task: this.task,
          cache: false,
          onAttempt: (id) => {
            this.task.attemptId = id;
            store.save();
          },
          onContext: () => store.save(),
        },
      );
    },
    restart() {
      engine.stop();
      store.close();
      store = new Store(path);
      engine = new Engine(store);
    },
    close() {
      engine.stop();
      store.close();
      globalThis.fetch = originalFetch;
      Object.assign(managedInfo, info);
      names.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const artifact =
  'B - A = $35 - $20 = $15. B costs $15 more than A. This establishes a price difference, not service quality.';
const assessment = {
  outcome: 'complete',
  checks: [
    { criterion: 'c1: Compute the price difference', status: 'met', evidence: '$35 - $20 = $15.' },
  ],
};
const reply = (text: string) =>
  Response.json({
    message: { content: text },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 100,
    eval_count: 80,
  });

test('artifact-first separates actual writing from control metadata and cannot replace the saved answer', async () => {
  const h = await fixture(),
    requests: any[] = [];
  try {
    globalThis.fetch = (async (_url, options) => {
      const packet = JSON.parse(String(options?.body)),
        data = JSON.parse(packet.messages[1].content);
      requests.push(packet);
      if (!packet.format) {
        assert.ok(data.agentContext.interactionTemplate);
        return reply(artifact);
      }
      assert.ok(packet.format.anyOf.every((branch: any) => !branch.properties.deliverable));
      assert.equal(
        data.recentWork.find((source: any) => source.sourceId === 'local-deliverable').output,
        artifact,
      );
      return reply(
        JSON.stringify({
          ...assessment,
          deliverable: 'Attempted replacement from an untrusted provider fixture',
        }),
      );
    }) as typeof fetch;
    assert.equal(await h.run(), artifact);
    assert.equal(h.task.result!.deliverable, artifact);
    assert.equal(h.task.localArtifact, undefined);
    assert.equal(requests.length, 2);
    assert.equal(h.store.attempts().length, 2);
    assert.ok(backupSchema.safeParse(h.store.backup()).success);
  } finally {
    h.close();
  }
});

test('a saved artifact survives a request-limit failure and restart without repeating the writing call', async () => {
  const h = await fixture();
  let writing = 0,
    checking = 0;
  try {
    globalThis.fetch = (async (_url, options) => {
      const packet = JSON.parse(String(options?.body));
      if (!packet.format) {
        writing++;
        return reply(artifact);
      }
      checking++;
      return reply(JSON.stringify(assessment));
    }) as typeof fetch;
    h.store.state.policy!.maxRequests24h = 1;
    await assert.rejects(h.run(), /request limit/);
    assert.equal(h.task.localArtifact!.text, artifact);
    h.task.status = 'failed';
    h.store.save();
    h.restart();
    assert.equal(h.task.localArtifact!.text, artifact);
    const archived = JSON.parse(
      archivedSource(h.store.state, h.project, `task:${h.task.id}`)!.text,
    );
    assert.equal(archived.unacceptedDraft, artifact);
    assert.match(archived.unacceptedDraftNotice, /Not accepted/);
    h.store.state.policy!.maxRequests24h = 30;
    assert.equal(await h.run(), artifact);
    assert.equal(writing, 1);
    assert.equal(checking, 1);
    assert.equal(h.task.localArtifact, undefined);
  } finally {
    h.close();
  }
});

test('editing the assignment invalidates its pending artifact instead of assessing stale work', async () => {
  const h = await fixture();
  let writing = 0;
  try {
    globalThis.fetch = (async (_url, options) => {
      const packet = JSON.parse(String(options?.body));
      if (!packet.format) {
        writing++;
        return reply(writing === 1 ? artifact : 'Updated answer using the changed assignment.');
      }
      return reply(JSON.stringify(assessment));
    }) as typeof fetch;
    h.store.state.policy!.maxRequests24h = 1;
    await assert.rejects(h.run(), /request limit/);
    h.task.description = 'Compare a different supplied pair, and label it changed.';
    h.store.state.policy!.maxRequests24h = 30;
    assert.equal(await h.run(), 'Updated answer using the changed assignment.');
    assert.equal(writing, 2);
  } finally {
    h.close();
  }
});

test('a confirmed assessment receipt recovers the original artifact offline across the result-transition crash boundary', async () => {
  const h = await fixture();
  let calls = 0;
  try {
    globalThis.fetch = (async (_url, options) => {
      calls++;
      return reply(
        JSON.parse(String(options?.body)).format ? JSON.stringify(assessment) : artifact,
      );
    }) as typeof fetch;
    await h.run();
    // Do not save the in-memory result transition: only the draft and confirmed
    // provider receipts have reached SQLite at this crash boundary.
    h.restart();
    assert.equal(h.task.status, 'failed');
    assert.equal(h.task.recovery?.hasResponse, true);
    h.engine.recoverTask(h.task.id);
    assert.equal(h.task.status, 'done');
    assert.equal(h.task.output, artifact);
    assert.equal(h.task.localArtifact, undefined);
    assert.equal(calls, 2);
  } finally {
    h.close();
  }
});

test('calculator retrievals produce separate immutable receipts retrievable only within their project', async () => {
  const h = await fixture();
  let assessments = 0;
  try {
    globalThis.fetch = (async (_url, options) => {
      const packet = JSON.parse(String(options?.body)),
        input = JSON.parse(packet.messages[1].content);
      if (!packet.format) return reply(artifact);
      if (assessments++ < 2)
        return reply(
          JSON.stringify({
            outcome: 'retrieve',
            requests: [
              {
                sourceId: 'tool:calculate',
                offset: 0,
                query: assessments === 1 ? '35 - 20' : '0.1 + 0.2',
              },
            ],
          }),
        );
      const receipts = input.requestedSources.filter((s: any) =>
        s.sourceId.startsWith('requested:calculation:'),
      );
      assert.equal(receipts.length, 2);
      assert.match(receipts[0].text, /"exact":"15"/);
      assert.match(receipts[1].text, /"exact":"3\/10"/);
      return reply(JSON.stringify(assessment));
    }) as typeof fetch;
    assert.equal(await h.run(), artifact);
    const receipts = h.task.toolLog!.filter((entry) => entry.type === 'calculator');
    assert.equal(receipts.length, 2);
    assert.notEqual(receipts[0].id, receipts[1].id);
    assert.match(
      archivedSource(h.store.state, h.project, `calculation:${receipts[0].id}`)!.text,
      /"exact":"15"/,
    );
    assert.equal(
      archivedSource(
        h.store.state,
        { ...h.project, id: 'another-project' },
        `calculation:${receipts[0].id}`,
      ),
      undefined,
    );
    assert.equal(h.store.attempts().length, 4);
  } finally {
    h.close();
  }
});

test('a writing receipt recovered offline still requires assessment and does not redispatch the writer', async () => {
  const h = await fixture();
  let writes = 0;
  try {
    globalThis.fetch = (async (_url, options) => {
      if (JSON.parse(String(options?.body)).format) return reply(JSON.stringify(assessment));
      writes++;
      return reply(artifact);
    }) as typeof fetch;
    h.store.state.policy!.maxRequests24h = 1;
    await assert.rejects(h.run(), /request limit/);
    // Simulate a crash after the response receipt but before its draft checkpoint.
    h.task.localArtifact!.text = '';
    h.store.save();
    h.restart();
    assert.equal(h.task.recovery!.hasResponse, true);
    h.engine.recoverTask(h.task.id);
    assert.equal(h.task.localArtifact!.text, artifact);
    assert.equal(h.task.status, 'failed', 'a recovered draft is not an accepted task');
    h.store.state.policy!.maxRequests24h = 30;
    assert.equal(await h.run(), artifact);
    assert.equal(writes, 1);
  } finally {
    h.close();
  }
});

test('an edited standing direction outside the recent conversation invalidates the draft checkpoint', async () => {
  const h = await fixture();
  let writes = 0;
  try {
    h.store.state.projectMessages ||= [];
    const direction = {
      id: randomUUID(),
      projectId: h.project.id,
      content: 'Keep the answer concise.',
      kind: 'direction' as const,
      active: true,
      createdAt: 1,
    };
    h.store.state.projectMessages.push(direction);
    for (let i = 0; i < 13; i++)
      h.store.state.projectMessages.push({
        id: randomUUID(),
        projectId: h.project.id,
        content: `Historical question ${i}`,
        kind: 'question',
        createdAt: i + 2,
      });
    globalThis.fetch = (async (_url, options) => {
      const packet = JSON.parse(String(options?.body));
      if (packet.format) return reply(JSON.stringify(assessment));
      writes++;
      return reply(artifact);
    }) as typeof fetch;
    h.store.state.policy!.maxRequests24h = 1;
    await assert.rejects(h.run(), /request limit/);
    direction.content = 'Include a clear warning that service value is unknown.';
    h.store.state.policy!.maxRequests24h = 30;
    await h.run();
    assert.equal(writes, 2);
  } finally {
    h.close();
  }
});
