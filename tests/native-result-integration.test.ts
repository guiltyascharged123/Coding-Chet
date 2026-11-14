import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { managedInfo } from '../server/managed.js';
import { runTask } from '../server/providers.js';
import type { Task } from '../shared/types.js';
import { result } from './work-fixtures.js';

test(
  'native response recovery dispatches a restricted text request and never replays the coding job (CLI protocol fixture)',
  {
    skip:
      process.platform === 'win32'
        ? 'Executable shebang fixture requires Unix; pure result-recovery tests run on Windows.'
        : false,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'workroom-native-repair-'));
    const old = { ...managedInfo },
      oldProvider = process.env.AGENT_PROVIDER,
      oldBin = process.env.WORKROOM_CODEX_BIN;
    const store = new Store(':memory:'),
      engine = new Engine(store);
    const calls = join(root, 'calls.jsonl');
    const executable = join(root, 'codex-fixture');
    const record = result({
      checks: [{ criterion: 'c1: Run behavior checks', status: 'met', evidence: 'npm test' }],
    });
    writeFileSync(
      executable,
      `#!${process.execPath}
import { appendFileSync } from 'node:fs';
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const correction = prompt.includes('Repair the supplied work record only.');
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({correction,args:process.argv.slice(2)})+'\\n');
const emit = (event) => console.log(JSON.stringify(event));
emit({type:'thread.started',thread_id:'fixture'});
emit({type:'turn.started'});
if (!correction) {
  emit({type:'item.completed',item:{id:'change',type:'file_change',status:'completed',changes:[{path:'src/value.ts',kind:'update'}]}});
  emit({type:'item.completed',item:{id:'test',type:'command_execution',command:'npm test',aggregated_output:'3 fixture tests passed',exit_code:0,status:'completed'}});
}
emit({type:'item.completed',item:{id:'reply',type:'agent_message',text:correction?${JSON.stringify(JSON.stringify(record))}:'{malformed fixture reply'}});
emit({type:'turn.completed',usage:{input_tokens:100,output_tokens:100,cached_input_tokens:0}});
`,
      { mode: 0o700 },
    );
    // The fake CLI emits deterministic events. This verifies dispatch and accounting,
    // not a real Codex account, native sandbox or the correctness of project code.
    process.env.AGENT_PROVIDER = 'codex';
    process.env.WORKROOM_CODEX_BIN = executable;
    Object.assign(managedInfo, { codexReady: true, codingReady: true });
    try {
      const project = await engine.createProject(
        'Native recovery fixture',
        'Verify completed work record recovery.',
        'office',
        'manual',
        randomUUID(),
        'custom',
      );
      const task: Task = {
        id: randomUUID(),
        projectId: project.id,
        title: 'Implement fixture',
        description: 'Fixture assignment',
        agentId: project.team![0].id,
        dependencies: [],
        requiresApproval: false,
        status: 'working',
        output: '',
        feedback: '',
        workType: 'implementation',
        acceptanceCriteria: [
          { id: 'c1', description: 'Run behavior checks', evidence: 'verification' },
        ],
      };
      const output = await runTask(
        'codex',
        project,
        task,
        project.team![0],
        [],
        new AbortController().signal,
        { store, project, task, workspace: root, cache: false },
      );
      assert.equal(output, record.deliverable);
      assert.equal(task.result?.outcome, 'complete');
      assert.equal(task.responseIssue, undefined);
      const dispatched = readFileSync(calls, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        dispatched.map((call) => call.correction),
        [false, true],
      );
      const correctionArgs = dispatched[1].args.join(' ');
      assert.match(correctionArgs, /features\.shell_tool=false/);
      assert.match(correctionArgs, /features\.apply_patch_freeform=false/);
      assert.match(correctionArgs, /workroom_document/);
      assert.ok(!correctionArgs.includes(root + ' = "write"'));
      assert.equal(store.attempts().length, 2);
      assert.ok(store.attempts().every((attempt) => attempt.status === 'completed'));
      assert.equal(task.observations?.length, 2);
    } finally {
      Object.assign(managedInfo, old);
      if (oldProvider === undefined) delete process.env.AGENT_PROVIDER;
      else process.env.AGENT_PROVIDER = oldProvider;
      if (oldBin === undefined) delete process.env.WORKROOM_CODEX_BIN;
      else process.env.WORKROOM_CODEX_BIN = oldBin;
      engine.stop();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
