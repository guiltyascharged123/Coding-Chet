import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReportedBlocker } from '../shared/task-blocker.js';
import { taskCapabilities } from '../shared/capabilities.js';
import { result } from './work-fixtures.js';

test('a reported blocker stays distinct from a later transport failure or accepted result', () => {
  const blocked = result({
    outcome: 'blocked',
    summary: 'Actual experiment measurements are missing.',
  });
  const task = { status: 'failed' as const, result: blocked, error: blocked.summary };
  assert.equal(isReportedBlocker(task), true);
  assert.equal(isReportedBlocker({ ...task, error: 'The model service is unavailable.' }), false);
  assert.equal(isReportedBlocker({ ...task, status: 'working' }), false);
  assert.equal(isReportedBlocker({ ...task, status: 'done', result: result() }), false);
  assert.equal(isReportedBlocker({ status: 'failed', error: 'Legacy failure' }), false);
});

test('text planners do not gain execution or external-service authority from their role or a workspace flag', () => {
  const local = taskCapabilities({ provider: 'ollama', workMode: 'text' });
  const community = taskCapabilities({ provider: 'compatible', workMode: 'text' });
  assert.deepEqual(community, local);
  assert.equal(local.commands, false);
  assert.equal(local.webResearch, false);
  assert.equal(local.externalActions, false);
  assert.equal(taskCapabilities({ provider: 'compatible', workMode: 'workspace' }).commands, false);
  const executor = taskCapabilities({
    provider: 'compatible',
    workMode: 'workspace',
    executor: { provider: 'codex', model: 'fixture-no-inference' },
  });
  assert.equal(executor.commands, true);
  assert.equal(executor.fileEditing, true);
  assert.equal(executor.externalActions, false);
  assert.equal(
    taskCapabilities({ provider: 'codex', workMode: 'workspace', deliveryMode: 'design' })
      .fileEditing,
    false,
  );
  assert.equal(taskCapabilities({ provider: 'codex', researchEnabled: true }).webResearch, true);
});
