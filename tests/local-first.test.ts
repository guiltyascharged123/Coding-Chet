import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { managedInfo, refreshManagedInfo } from '../server/managed.js';
import { runtimeInfo } from '../server/providers.js';
import { DEFAULT_LOCAL_MODEL } from '../shared/defaults.js';
import { backupSchema } from '../shared/schemas.js';
import { result } from './work-fixtures.js';

async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Expected local-model work did not finish');
}

test('unavailable models stay selected, planning saves an actionable blocker, and normal projects cannot simulate work', async () => {
  const before = process.env.WORKROOM_DEMO,
    override = process.env.AGENT_PROVIDER,
    ready = managedInfo.ollamaReady;
  delete process.env.WORKROOM_DEMO;
  process.env.AGENT_PROVIDER = 'ollama';
  managedInfo.ollamaReady = false;
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    assert.equal(store.state.provider, 'ollama');
    assert.equal(store.state.projects.length, 0);
    assert.equal(runtimeInfo().available.demo, false);
    const project = await engine.createProject(
      'A real goal',
      'Compare supplied costs and provide useful evidence.',
      'office',
      'ai',
      undefined,
      'office',
    );
    assert.equal(project.planningStatus, 'failed');
    assert.match(project.planningError!, /No model request was sent/);
    assert.equal(store.attempts().length, 0);
    assert.equal(store.state.provider, 'ollama');
    engine.starterPlan(project.id);
    assert.equal(project.planning, 'manual');
    assert.deepEqual(store.state.tasks, []);
    project.provider = 'demo';
    assert.throws(() => engine.runProject(project.id), /saved simulation project/);
    assert.throws(() => engine.setProvider('demo'), /not configured/);
    assert.ok(backupSchema.safeParse(store.backup()).success);
    const legacy = store.backup();
    legacy.state.provider = 'demo';
    engine.restore(legacy);
    assert.equal(
      engine.state.provider,
      'ollama',
      'legacy backup does not restore a simulation default',
    );
    assert.equal(
      engine.state.projects[0].provider,
      'demo',
      'historical project identity is preserved',
    );
  } finally {
    engine.stop();
    store.close();
    managedInfo.ollamaReady = ready;
    if (before === undefined) delete process.env.WORKROOM_DEMO;
    else process.env.WORKROOM_DEMO = before;
    if (override === undefined) delete process.env.AGENT_PROVIDER;
    else process.env.AGENT_PROVIDER = override;
  }
});

test('local planning and task handoffs use actual Ollama protocol responses, structured formats and no thinking output', async () => {
  const oldFetch = globalThis.fetch;
  const names = ['WORKROOM_DEMO', 'AGENT_PROVIDER', 'OLLAMA_MODEL', 'WORKROOM_CODEX_ENABLED'];
  const saved = names.map((name) => process.env[name]);
  const oldManaged = { ...managedInfo };
  delete process.env.WORKROOM_DEMO;
  process.env.AGENT_PROVIDER = 'ollama';
  process.env.OLLAMA_MODEL = DEFAULT_LOCAL_MODEL;
  delete process.env.WORKROOM_CODEX_ENABLED;
  let calls = 0;
  const store = new Store(':memory:'),
    engine = new Engine(store, 1);
  try {
    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith('/api/tags'))
        return Response.json({ models: [{ name: DEFAULT_LOCAL_MODEL }] });
      if (!String(url).endsWith('/api/chat'))
        throw new Error('Unexpected provider request in local fixture');
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, DEFAULT_LOCAL_MODEL);
      assert.equal(request.think, false);
      assert.equal(request.stream, false);
      assert.equal(typeof request.format, 'object');
      const input = JSON.parse(request.messages[1].content);
      calls++;
      let value;
      if (!input.task) {
        assert.ok(request.format.properties.tasks);
        value = {
          tasks: [
            {
              title: 'Compare supplied costs',
              description:
                'Calculate the difference between A at $20 and B at $35. Acceptance: the arithmetic is shown.',
              agentId: 'mira',
              dependencies: [],
              requiresApproval: false,
            },
            {
              title: 'Check the comparison',
              description:
                'Independently check the arithmetic and label unknown demand. Acceptance: report evidence and limitations.',
              agentId: 'echo',
              dependencies: [0],
              requiresApproval: false,
            },
          ],
        };
      } else {
        assert.ok(request.format.properties.checks);
        if (calls === 3) assert.match(input.teammateOutputs[0].output, /Option A saves \$15/);
        value = result();
      }
      return Response.json({
        message: { content: JSON.stringify(value) },
        done_reason: 'stop',
        prompt_eval_count: 100,
        eval_count: 100,
      });
    }) as typeof fetch;
    await refreshManagedInfo();
    assert.equal(managedInfo.ollamaReady, true);
    const project = await engine.createProject(
      'Local cost comparison',
      'Compare A at $20 and B at $35, showing evidence. Do not claim any transactions.',
      'office',
      'ai',
      undefined,
      'office',
    );
    await until(() => project.planningStatus === 'ready');
    engine.start();
    engine.runProject(project.id);
    await until(() => project.status === 'completed');
    assert.equal(calls, 3, 'one model plan and two role-specific assignments');
    assert.equal(store.state.approvals.length, 0);
    assert.ok(store.state.tasks.every((t) => t.result?.outcome === 'complete'));
    assert.ok(
      store
        .attempts()
        .every((a) => a.provider === 'ollama' && a.billing === 'local' && a.status === 'completed'),
    );
  } finally {
    engine.stop();
    store.close();
    globalThis.fetch = oldFetch;
    Object.assign(managedInfo, oldManaged);
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
});
