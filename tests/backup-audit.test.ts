process.env.WORKROOM_DEMO = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../server/seed.js';
import { auditBackup } from '../server/backup-audit.js';
import { result } from './work-fixtures.js';

function fixture() {
  const state = initialState(true);
  const project = state.projects[0];
  project.provider = 'compatible';
  project.model = 'model-fixture';
  project.brief = 'PRIVATE BRIEF: untrusted document instructions must never execute.';
  return { format: 'workroom', version: 2, createdAt: Date.now(), state, attempts: [] };
}

test('read-only backup audit identifies text execution and preserves retained failed work without disclosing it', () => {
  const backup = fixture();
  const task = backup.state.tasks.find((t) => t.projectId === backup.state.projects[0].id)!;
  task.status = 'failed';
  task.error = 'Compatible model server returned HTTP 403. PRIVATE ERROR';
  task.output = 'PRIVATE OUTPUT';
  task.result = result();
  const before = structuredClone(backup);
  const audit = auditBackup(backup);
  const project = audit.projects[0];
  assert.equal(project.mode, 'text');
  assert.equal(project.configuredCapabilities.commands, false);
  assert.equal(project.tasks.retainedFailedWork, 1);
  assert.ok(project.issues.some((i) => i.startsWith('TEXT_ONLY')));
  assert.ok(project.issues.some((i) => i.startsWith('SERVICE_ACCESS')));
  assert.ok(project.issues.some((i) => i.startsWith('NO_TOOL_EVENTS')));
  assert.doesNotMatch(JSON.stringify(audit), /PRIVATE/);
  assert.deepEqual(backup, before);
});

test('audit distinguishes configured Codex tools, read-only design and unknown external workers from readiness', () => {
  const backup = fixture();
  const project = backup.state.projects[0];
  project.workMode = 'workspace';
  project.executor = { provider: 'codex', model: 'executor-fixture' };
  project.deliveryMode = 'design';
  let report = auditBackup(backup);
  assert.equal(report.projects[0].configuredCapabilities.commands, true);
  assert.equal(report.projects[0].configuredCapabilities.fileEditing, false);
  assert.ok(!report.projects[0].issues.some((i) => i.startsWith('TEXT_ONLY')));
  assert.match(report.readiness, /Not checked/);
  delete project.executor;
  project.workMode = 'text';
  project.provider = 'external';
  report = auditBackup(backup);
  assert.ok(report.projects[0].issues.some((i) => i.startsWith('EXTERNAL_WORKER')));
  assert.ok(!report.projects[0].issues.some((i) => i.startsWith('TEXT_ONLY')));
});

test('audit rejects malformed exports before producing a capability report', () => {
  assert.throws(() => auditBackup({ format: 'workroom', state: {} }));
});
