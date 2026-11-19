import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { initialState } from '../server/seed.js';
import {
  refreshContainerInfo,
  sandboxAction,
  containerCapabilityIssue,
  containerResourceCheck,
} from '../server/container-sandbox.js';
import { runToolLoop } from '../server/tool-loop.js';
import { runTask } from '../server/providers.js';
import { Store } from '../server/store.js';
import { backupSchema, defaultPolicy } from '../shared/schemas.js';
import { result } from './work-fixtures.js';

const signal = () => new AbortController().signal;
test('the actual container bootstrap rejects unenforced cgroups before executing a payload', (t) => {
  try {
    execFileSync('docker', ['image', 'inspect', 'node:24-alpine'], { stdio: 'ignore' });
  } catch {
    return t.skip('Docker image unavailable for the real bootstrap rejection check.');
  }
  const root = mkdtempSync(join(tmpdir(), 'workroom-bootstrap-'));
  chmodSync(root, 0o777);
  try {
    let rejected = false;
    try {
      execFileSync(
        'docker',
        [
          'run',
          '--rm',
          '--network=none',
          '--cgroupns=private',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--mount',
          `type=bind,src=${root},dst=/project`,
          'node:24-alpine',
          'node',
          '-e',
          containerResourceCheck({ memory: 512 * 1048576, cpus: 1, processes: 128 }) +
            `require('fs').writeFileSync('/project/must-not-run','x');`,
        ],
        { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      rejected = true;
      assert.match(String((error as { stderr?: string }).stderr), /No model-selected code was run/);
    }
    assert.equal(rejected, true);
    assert.equal(existsSync(join(root, 'must-not-run')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('execution fails closed when rootless Docker cannot enforce the promised resource budgets', () => {
  const capable = {
    SecurityOptions: ['name=rootless', 'name=seccomp,profile=builtin'],
    CgroupVersion: '2',
    MemoryLimit: true,
    CPUCfsQuota: true,
    PidsLimit: true,
  };
  assert.equal(containerCapabilityIssue(capable), undefined);
  assert.match(
    containerCapabilityIssue({
      ...capable,
      SecurityOptions: ['name=rootless', 'name=seccomp,profile=unconfined'],
    })!,
    /seccomp/,
  );
  for (const field of ['MemoryLimit', 'CPUCfsQuota', 'PidsLimit'] as const)
    assert.match(containerCapabilityIssue({ ...capable, [field]: false })!, /blocked/);
  assert.match(
    containerCapabilityIssue({ ...capable, SecurityOptions: ['name=rootless'] })!,
    /seccomp/,
  );
  assert.match(containerCapabilityIssue({ ...capable, SecurityOptions: [] })!, /rootless/);
});
function fixture() {
  const state = initialState(true),
    project = state.projects[0],
    task = state.tasks[0];
  project.provider = 'ollama';
  project.model = 'tool-loop-fixture';
  project.workMode = 'container';
  task.workType = 'implementation';
  task.acceptanceCriteria = [
    { id: 'c1', description: 'Create the useful utility', evidence: 'artifact' },
    { id: 'c2', description: 'Run its meaningful behavior test', evidence: 'verification' },
  ];
  return { state, project, task };
}
const completed = () =>
  result({
    deliverable:
      'Created the actual numeric utility and ran its assertion test successfully. No external outcome is claimed.',
    checks: [
      {
        criterion: 'c1: Create the utility',
        status: 'met',
        evidence: 'utility.mjs contains the actual implementation.',
      },
      {
        criterion: 'c2: Verify behavior',
        status: 'met',
        evidence: 'node --test utility.test.mjs passed.',
      },
    ],
  });

test('an actual direct-model adapter creates and tests a utility through rootless Docker and a separate specialist inspects it (HTTP model fixture)', async (t) => {
  const ready = await refreshContainerInfo();
  if (!ready.ready) return t.skip(ready.message);
  const root = mkdtempSync(join(tmpdir(), 'workroom-container-'));
  // This CI daemon runs as a separate rootless user. Share only disposable
  // synthetic fixtures; production requires Docker under the Workroom user.
  chmodSync(root, 0o777);
  const { state, project, task } = fixture();
  const store = new Store(':memory:');
  store.state = state;
  store.state.policy = {
    ...defaultPolicy,
    maxInputBytes: 24000,
    maxOutputTokens: 1800,
    localContextTokens: 8192,
  };
  const replies = [
    {
      action: 'write',
      id: 'implementation',
      path: 'utility.mjs',
      content: 'export const add = (a,b) => a+b;',
    },
    {
      action: 'write',
      id: 'behavior-test',
      path: 'utility.test.mjs',
      content:
        "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {add} from './utility.mjs'; test('actual addition',()=>{assert.equal(add(8,7),15);assert.equal(add(-2,3),1)});",
    },
    { action: 'run', id: 'verify', command: 'node --test utility.test.mjs' },
    { action: 'finish', result: { ...completed(), summary: undefined, handoff: undefined } },
  ];
  let requests = 0;
  const server = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    assert.equal(body.model, project.model);
    assert.match(body.messages[0].content, /actual goal/);
    assert.doesNotMatch(body.messages[0].content, /For money\/resource goals/);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        message: { content: JSON.stringify(replies[requests++]) },
        done: true,
        done_reason: 'stop',
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const before = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  const snapshots: string[] = [];
  try {
    await runTask('ollama', project, task, state.agents[0], [], signal(), {
      store,
      workspace: root,
      project,
      task,
      onContext: () => snapshots.push(JSON.stringify(task.sandboxJournal)),
    });
    assert.equal(requests, 4);
    assert.equal(
      task.result?.outcome,
      'complete',
      JSON.stringify({
        result: task.result,
        observations: task.observations,
        journal: task.sandboxJournal,
      }),
    );
    assert.equal(
      readFileSync(join(root, 'utility.mjs'), 'utf8'),
      'export const add = (a,b) => a+b;',
    );
    assert.equal(task.sandboxJournal?.length, 3);
    assert.ok(snapshots.some((s) => s.includes('"status":"started"')));
    assert.ok(
      task.observations?.some(
        (o) => o.kind === 'verification' && o.reference === 'node --test utility.test.mjs',
      ),
    );
    const restored = backupSchema.parse(
      JSON.parse(
        JSON.stringify({
          format: 'workroom',
          version: 2,
          createdAt: Date.now(),
          state,
          attempts: [],
        }),
      ),
    );
    assert.deepEqual(restored.state.tasks[0].sandboxJournal, task.sandboxJournal);
    const reviewer = structuredClone(state.tasks[1]);
    reviewer.workType = 'review';
    reviewer.acceptanceCriteria = [
      { id: 'r1', description: 'Independently inspect implementation', evidence: 'inspection' },
    ];
    const reviewReplies = [
      { action: 'read', id: 'inspect', path: 'utility.mjs' },
      {
        action: 'finish',
        result: result({
          checks: [
            {
              criterion: 'r1: Independent inspection',
              status: 'met',
              evidence: 'Inspected read-file utility.mjs directly.',
            },
          ],
        }),
      },
    ];
    await runToolLoop(reviewer, {}, signal(), { workspace: root, readOnly: true }, async () =>
      JSON.stringify(reviewReplies.shift()),
    );
    assert.equal(reviewer.result?.outcome, 'complete');
    assert.match(reviewer.sandboxJournal?.[0].output || '', /a\+b/);
  } finally {
    if (before === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = before;
    store.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('real sandbox denies host files, read-only project writes, system writes and host/network access', async (t) => {
  const ready = await refreshContainerInfo();
  if (!ready.ready) return t.skip(ready.message);
  const parent = mkdtempSync(join(tmpdir(), 'workroom-isolation-')),
    root = join(parent, 'project');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(root);
  chmodSync(root, 0o777);
  const sibling = join(parent, 'host-secret');
  writeFileSync(sibling, 'private marker');
  try {
    const hostRead = await sandboxAction(
      root,
      {
        action: 'run',
        id: 'host',
        command: `node -e 'require("fs").readFileSync(process.argv[1])' '${sibling}'`,
      },
      signal(),
    );
    assert.notEqual(hostRead.exitCode, 0);
    assert.doesNotMatch(hostRead.output, /private marker/);
    const system = await sandboxAction(
      root,
      {
        action: 'run',
        id: 'system',
        command: 'node -e \'require("fs").writeFileSync("/etc/workroom-test","x")\'',
      },
      signal(),
    );
    assert.notEqual(system.exitCode, 0);
    const readonly = await sandboxAction(
      root,
      {
        action: 'run',
        id: 'readonly',
        command: 'node -e \'require("fs").writeFileSync("blocked","x")\'',
      },
      signal(),
      true,
    );
    assert.notEqual(readonly.exitCode, 0);
    assert.equal(existsSync(join(root, 'blocked')), false);
    assert.equal(
      (
        await sandboxAction(
          root,
          { action: 'write', id: 'traversal', path: '../escape', content: 'x' },
          signal(),
        )
      ).exitCode,
      2,
    );
    const net = await sandboxAction(
      root,
      {
        action: 'run',
        id: 'net',
        command:
          'node -e \'const s=require("net").connect({host:"1.1.1.1",port:443});s.on("connect",()=>process.exit(17));s.on("error",()=>{console.log("network blocked");process.exit(0)});setTimeout(()=>process.exit(18),2000)\'',
      },
      signal(),
    );
    assert.equal(net.exitCode, 0);
    assert.match(net.output, /network blocked/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('cancelling a running command stops its child process before delayed project writes', async (t) => {
  const ready = await refreshContainerInfo();
  if (!ready.ready) return t.skip(ready.message);
  const root = mkdtempSync(join(tmpdir(), 'workroom-cancel-'));
  chmodSync(root, 0o777);
  const controller = new AbortController();
  assert.equal(
    (
      await sandboxAction(
        root,
        {
          action: 'write',
          id: 'delayed-child',
          path: 'delayed.mjs',
          content:
            "import fs from 'node:fs'; fs.writeFileSync('started','x'); setTimeout(()=>fs.writeFileSync('leaked','x'),3000);",
        },
        signal(),
      )
    ).exitCode,
    0,
  );
  const action = sandboxAction(
    root,
    {
      action: 'run',
      id: 'cancel-tree',
      command: `node -e 'require("child_process").spawn(process.execPath,["delayed.mjs"],{stdio:"ignore"});setInterval(()=>{},1000)'`,
    },
    controller.signal,
  );
  // Install the rejection handler before aborting to avoid an unhandled promise.
  const rejected = assert.rejects(action, /cancelled/);
  try {
    for (let i = 0; i < 400 && !existsSync(join(root, 'started')); i++)
      await new Promise((r) => setTimeout(r, 25));
    assert.equal(
      existsSync(join(root, 'started')),
      true,
      'The actual command must start before cancellation.',
    );
    controller.abort();
    await rejected;
    await new Promise((r) => setTimeout(r, 3300));
    assert.equal(existsSync(join(root, 'leaked')), false);
  } finally {
    controller.abort();
    await rejected;
    rmSync(root, { recursive: true, force: true });
  }
});

test('uncertain actions require explicit recovery and a complete claim without tool evidence is blocked', async () => {
  const { task } = fixture();
  task.sandboxJournal = [
    { id: 'uncertain', action: 'run', reference: 'node script.mjs', status: 'started', output: '' },
  ];
  await assert.rejects(
    runToolLoop(task, {}, signal(), { workspace: '/unused' }, async () => {
      throw Error('must not call model');
    }),
    /interrupted/,
  );
  task.sandboxJournal = [];
  await runToolLoop(task, {}, signal(), { workspace: '/unused' }, async () =>
    JSON.stringify({ action: 'finish', result: completed() }),
  );
  assert.equal(task.result?.outcome, 'blocked');
  assert.match(task.result?.summary || '', /not been verified/);
});

test('the runtime owns action IDs and restates a failed read so the model can create the missing file', async () => {
  const { task } = fixture();
  task.workType = 'plan';
  task.acceptanceCriteria = undefined;
  const replies = [
    { action: 'read', id: 'copied-example', path: 'needed.mjs' },
    {
      action: 'write',
      id: 'copied-example',
      path: 'needed.mjs',
      content: 'export const useful = true;',
    },
    { action: 'finish', result: result() },
  ];
  const ids: string[] = [],
    inputs: any[] = [];
  await runToolLoop(
    task,
    {},
    signal(),
    { workspace: '/unused' },
    async (input) => {
      inputs.push(input);
      return JSON.stringify(replies.shift());
    },
    async (_root, action) => {
      ids.push(action.id);
      return action.action === 'read'
        ? { output: 'ENOENT: no such file needed.mjs', exitCode: 1 }
        : { output: 'Real file write receipt', exitCode: 0, changed: true };
    },
  );
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.ok(!ids.some((id) => id === 'copied-example'));
  assert.match(inputs[1].actionCorrection, /does not exist/);
  assert.equal(inputs[1].lastToolResult.exitCode, 1);
  assert.equal(task.result?.outcome, 'complete');
});
