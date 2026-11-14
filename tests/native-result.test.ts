import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeResult } from '../server/native-result.js';
import { result } from './work-fixtures.js';
import type { Task } from '../shared/types.js';

const assignment: Pick<Task, 'workType' | 'acceptanceCriteria' | 'observations'> = {
  workType: 'implementation',
  acceptanceCriteria: [{ id: 'c1', description: 'Run behavior checks', evidence: 'verification' }],
  observations: [
    { id: 'change', kind: 'artifact', reference: 'src/calculation.ts', detail: 'update' },
    { id: 'test', kind: 'verification', reference: 'npm test', detail: '3 tests passed' },
  ],
};
const reply = () =>
  result({
    checks: [
      { criterion: 'c1: Run behavior checks', status: 'met', evidence: 'npm test: 3 tests passed' },
    ],
  });

test('a completed tool job can recover a malformed record without repeating execution', async () => {
  const rejected: string[] = [];
  let calls = 0;
  const recovered = await nativeResult(
    '```json\n{"unfinished":',
    assignment,
    1,
    async (raw, issues) => {
      calls++;
      assert.match(raw, /unfinished/);
      assert.match(issues.join(' '), /complete JSON/);
      return JSON.stringify(reply());
    },
    (raw) => rejected.push(raw),
  );
  assert.equal(calls, 1);
  assert.equal(rejected.length, 1);
  assert.equal(recovered.outcome, 'complete');
});

test('correction cannot manufacture tool receipts or certify missing acceptance checks', async () => {
  const task: typeof assignment = { ...assignment, observations: [] };
  const recovered = await nativeResult(
    'broken',
    task,
    1,
    async () => {
      task.observations = assignment.observations!;
      return JSON.stringify(reply());
    },
    () => {},
  );
  assert.equal(recovered.outcome, 'blocked', 'only observations captured before correction count');
  assert.match(recovered.summary, /observed file changes/);
  const missing = await nativeResult(
    JSON.stringify(result()),
    assignment,
    1,
    async () => {
      assert.fail('valid but unsupported records must be blocked, not repaired into success');
    },
    () => {},
  );
  assert.equal(missing.outcome, 'blocked');
  assert.match(missing.summary, /Acceptance c1/);
});

test('correction limits and errors preserve the rejection rather than replaying the job', async () => {
  for (const limit of [0, 2]) {
    let calls = 0,
      saved = 0;
    await assert.rejects(
      nativeResult(
        'bad',
        assignment,
        limit,
        async () => {
          calls++;
          return 'still bad';
        },
        () => {
          saved++;
        },
      ),
      /code work was not automatically repeated/,
    );
    assert.equal(calls, limit);
    assert.equal(saved, limit + 1);
  }
  let saved = false;
  await assert.rejects(
    nativeResult(
      'bad',
      assignment,
      1,
      async () => {
        throw new Error('request budget exhausted');
      },
      () => {
        saved = true;
      },
    ),
    /budget exhausted/,
  );
  assert.ok(saved);
});

test('human decisions and concrete specialist handoffs survive response recovery', async () => {
  for (const record of [
    result({
      outcome: 'needs_input',
      decision: {
        question: 'Which licensed dataset may we use?',
        why: 'The required source is not supplied.',
        options: ['Supply a dataset', 'Proceed with synthetic data'],
        recommended: 'Supply a dataset',
      },
    }),
    result({
      outcome: 'continue',
      followUps: [
        {
          title: 'Review actual changes',
          description: 'Inspect the calculation independently.',
          agentId: 'echo',
        },
      ],
    }),
  ]) {
    const recovered = await nativeResult(
      'bad',
      assignment,
      1,
      async () => JSON.stringify(record),
      () => {},
    );
    assert.equal(recovered.outcome, record.outcome);
    assert.deepEqual(recovered.decision, record.decision);
    assert.deepEqual(recovered.followUps, record.followUps);
  }
});
