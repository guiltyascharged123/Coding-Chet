import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { managedInfo } from '../server/managed.js';
import { projectWorkspace } from '../server/workspaces.js';
import { taskExecutionProject } from '../shared/capabilities.js';
import { backupSchema } from '../shared/schemas.js';
import type { Task } from '../shared/types.js';
import { result } from './work-fixtures.js';

test('an explicit Codex executor builds, reviews and reuses an actual project utility while retaining the local planner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workroom-executor-'));
  const old = { ...managedInfo },
    before = process.env.AGENT_PROVIDER;
  process.env.AGENT_PROVIDER = 'ollama';
  Object.assign(managedInfo, {
    ollamaReady: true,
    ollamaModels: ['local-fixture'],
    codexReady: true,
    codingReady: true,
  });
  const store = new Store(join(root, 'workspace.sqlite'));
  const seen: string[] = [];
  const engine = new Engine(
    store,
    1,
    async (provider, connection, task, agent, context, _signal, ctx) => {
      assert.equal(provider, 'codex');
      assert.equal(connection.model, 'coding-fixture');
      assert.equal(
        store.state.projects.find((project) => project.id === connection.id)!.provider,
        'ollama',
      );
      const folder = ctx!.workspace!;
      assert.equal(connection.executor?.model, 'coding-fixture');
      assert.equal(ctx?.toolNetwork, false);
      const catalogPath = join(folder, 'tools/workroom-tools.json');
      const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
      assert.equal(catalog.tools[0].id, 'download-images');
      seen.push(agent.id);
      if (task.workType === 'implementation') {
        writeFileSync(
          join(folder, 'tools/difference.mjs'),
          'console.log(Number(process.argv[3]) - Number(process.argv[2]));',
        );
        catalog.tools.push({
          id: 'difference',
          command: 'node tools/difference.mjs <a> <b>',
          purpose: 'Calculate a supplied numeric difference.',
        });
        writeFileSync(catalogPath, JSON.stringify(catalog));
      } else assert.ok(catalog.tools.some((tool: any) => tool.id === 'difference'));
      const annual = agent.id === 'mira';
      const args = annual ? ['240', '420'] : ['20', '35'];
      const output = execFileSync(process.execPath, ['tools/difference.mjs', ...args], {
        cwd: folder,
        encoding: 'utf8',
      }).trim();
      assert.equal(output, annual ? '180' : '15');
      if (annual)
        assert.ok(
          context.some((previous) => previous.agentId === 'echo' && previous.output.includes('15')),
        );
      ctx?.onTrace?.({
        type: 'command',
        text: `$ node tools/difference.mjs ${args.join(' ')}\n${output}\nExit code: 0`,
        status: 'completed',
      });
      task.result = result({
        deliverable: `${agent.id} used tools/difference.mjs: ${output}. No market or revenue claim was made.`,
        checks: [
          {
            criterion: 'c1: Execute the actual utility',
            status: 'met',
            evidence: `node tools/difference.mjs ${args.join(' ')} returned ${output}.`,
          },
        ],
      });
      return task.result.deliverable;
    },
  );
  try {
    const project = await engine.createProject(
      'Reusable problem-solving tools',
      'Build a numeric comparison utility, independently review it, then reuse it for annual costs.',
      'office',
      'manual',
      randomUUID(),
      'custom',
    );
    project.model = 'local-fixture';
    assert.throws(
      () => engine.setProjectProvider(project.id, 'ollama', 'local-fixture', 'workspace', 0),
      /require Codex/,
    );
    engine.setProjectProvider(project.id, 'ollama', 'local-fixture', 'workspace', 0, {
      provider: 'codex',
      model: 'coding-fixture',
    });
    assert.equal(project.provider, 'ollama');
    assert.equal(project.model, 'local-fixture');
    assert.equal(taskExecutionProject(project).provider, 'codex');
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const tasks = ['implementation', 'review', 'plan'].map((workType, i) => ({
      id: ids[i],
      projectId: project.id,
      agentId: ['atlas', 'echo', 'mira'][i],
      title: ['Build utility', 'Review utility', 'Reuse utility'][i],
      description: 'Execute the actual utility and report its verified numeric result.',
      workType,
      dependencies: i ? [ids[i - 1]] : [],
      requiresApproval: false,
      status: 'queued',
      output: '',
      feedback: '',
      acceptanceCriteria: [
        { id: 'c1', description: 'Execute the actual utility', evidence: 'report' },
      ],
    })) as Task[];
    engine.editPlan(project.id, tasks);
    engine.start();
    engine.runProject(project.id);
    for (let i = 0; i < 1000 && project.status !== 'completed'; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(project.status, 'completed');
    assert.deepEqual(seen, ['atlas', 'echo', 'mira']);
    const commands = store.consoleEntries(project.id).filter((entry) => entry.type === 'command');
    assert.equal(commands.length, 3);
    assert.ok(
      commands.every((entry) => entry.provider === 'codex' && entry.model === 'coding-fixture'),
    );
    assert.ok(backupSchema.safeParse(store.backup()).success);
    store.restore(store.backup());
    assert.equal(engine.project(project.id).executor?.model, 'coding-fixture');
    const folder = projectWorkspace(store.path, project);
    assert.match(readFileSync(join(folder, 'tools/difference.mjs'), 'utf8'), /process.argv/);
    assert.throws(
      () =>
        engine.setProjectProvider(project.id, 'ollama', 'local-fixture', 'workspace', 0, {
          provider: 'codex',
          model: 'different',
        }),
      /changed|newer|revision/i,
    );
    engine.setProjectProvider(
      project.id,
      'ollama',
      'local-fixture',
      'text',
      engine.project(project.id).settingsRevision || 0,
      null,
    );
    assert.equal(engine.project(project.id).executor, undefined);
    assert.equal(taskExecutionProject(engine.project(project.id)).provider, 'ollama');
  } finally {
    engine.stop();
    await new Promise((r) => setTimeout(r, 10));
    store.close();
    Object.assign(managedInfo, old);
    if (before === undefined) delete process.env.AGENT_PROVIDER;
    else process.env.AGENT_PROVIDER = before;
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicitly authorized workspace coordinator delegates tool building while design-only mode remains read-only', async () => {
  for (const mode of ['hybrid', 'direct', 'design']) {
    const design = mode === 'design';
    const root = mkdtempSync(join(tmpdir(), 'workroom-delegate-tool-'));
    const old = { ...managedInfo },
      before = process.env.AGENT_PROVIDER;
    process.env.AGENT_PROVIDER = 'ollama';
    Object.assign(managedInfo, {
      ollamaReady: true,
      ollamaModels: ['local-fixture'],
      codexReady: true,
      codingReady: true,
    });
    const store = new Store(join(root, 'state.sqlite'));
    let coordinatorTurns = 0,
      builds = 0;
    const engine = new Engine(
      store,
      1,
      async (provider, connection, task, agent, context, _signal, ctx) => {
        assert.equal(provider, 'codex');
        if (agent.id === 'mira' && coordinatorTurns++ === 0) {
          assert.equal(ctx?.readOnly, true);
          task.result = result({
            outcome: 'continue',
            followUps: [
              {
                title: 'Build an executable price utility',
                description: 'Implement and test a project-owned numeric difference utility.',
                agentId: 'atlas',
                workType: 'implementation',
              },
              {
                title: 'Independently check the tool',
                description:
                  'Inspect and execute the saved utility before the coordinator uses it.',
                agentId: 'echo',
                workType: 'review',
              },
            ],
          });
          return task.result.deliverable;
        }
        const folder = ctx!.workspace!,
          file = join(folder, 'tools/difference.mjs');
        if (agent.id === 'atlas') {
          builds++;
          assert.equal(ctx?.readOnly, false);
          writeFileSync(file, 'console.log(35 - 20);');
        } else assert.equal(ctx?.readOnly, true);
        assert.equal(
          execFileSync(process.execPath, [file], { cwd: folder, encoding: 'utf8' }).trim(),
          '15',
        );
        if (agent.id === 'mira')
          assert.ok(
            context.some((source) => source.agentId === 'echo' && source.output.includes('15')),
          );
        task.result = result({
          deliverable: `${agent.id} executed the actual project utility: 15.`,
          checks: (task.acceptanceCriteria || [{ id: 'c1', description: 'Use tool' }]).map(
            (criterion) => ({
              criterion: `${criterion.id}: ${criterion.description}`,
              status: 'met',
              evidence: 'tools/difference.mjs executed and returned 15.',
            }),
          ),
        });
        return task.result.deliverable;
      },
    );
    try {
      const project = await engine.createProject(
        'Build needed tooling',
        'Use an executable project-owned utility, not a document about creating one.',
        'office',
        'manual',
        randomUUID(),
        'custom',
      );
      project.model = 'local-fixture';
      if (mode === 'direct')
        engine.setProjectProvider(project.id, 'codex', 'coding-fixture', 'workspace', 0);
      else
        engine.setProjectProvider(project.id, 'ollama', 'local-fixture', 'workspace', 0, {
          provider: 'codex',
          model: 'coding-fixture',
        });
      if (design) project.deliveryMode = 'design';
      engine.editPlan(project.id, [
        {
          id: randomUUID(),
          projectId: project.id,
          title: 'Solve using a verified utility',
          description:
            'Obtain a specialist-built utility and use the independently reviewed result.',
          agentId: 'mira',
          dependencies: [],
          requiresApproval: false,
          readOnly: true,
          workType: 'plan',
          status: 'queued',
          output: '',
          feedback: '',
        },
      ]);
      engine.start();
      engine.runProject(project.id);
      for (let i = 0; i < 1000 && !['completed', 'paused'].includes(project.status); i++)
        await new Promise((r) => setTimeout(r, 5));
      if (design) {
        assert.equal(project.status, 'paused');
        assert.equal(builds, 0);
        assert.match(store.state.tasks[0].error!, /write access unavailable/);
        assert.equal(store.state.tasks.length, 1);
      } else {
        assert.equal(
          project.status,
          'completed',
          store.state.tasks.find((task) => task.status === 'failed')?.error,
        );
        assert.equal(builds, 1);
        assert.equal(coordinatorTurns, 2);
        assert.equal(store.state.tasks.find((task) => task.agentId === 'atlas')!.readOnly, false);
        assert.equal(store.state.tasks.find((task) => task.agentId === 'mira')!.readOnly, true);
      }
    } finally {
      engine.stop();
      await new Promise((r) => setTimeout(r, 10));
      store.close();
      Object.assign(managedInfo, old);
      if (before === undefined) delete process.env.AGENT_PROVIDER;
      else process.env.AGENT_PROVIDER = before;
      rmSync(root, { recursive: true, force: true });
    }
  }
});
