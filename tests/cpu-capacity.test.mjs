import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuCapacity, localThreadOptions } from '../scripts/cpu-capacity.mjs';
const fixture = (values) => (path) => {
  if (!(path in values)) throw Error('Not available');
  return values[path];
};
test('CPU guidance honors cgroup v2/v1 quotas, fractional cores and unavailable hosts', () => {
  const constrained = cpuCapacity(fixture({ '/sys/fs/cgroup/cpu.max': '200000 100000' }), 168);
  assert.deepEqual(constrained, { affinityThreads: 168, quotaCores: 2, effectiveThreads: 2 });
  assert.deepEqual(localThreadOptions('', constrained), { num_thread: 2 });
  assert.deepEqual(
    localThreadOptions('', cpuCapacity(fixture({ '/sys/fs/cgroup/cpu.max': '200000 100000' }), 2)),
    { num_thread: 2 },
  );
  assert.equal(
    cpuCapacity(fixture({ '/sys/fs/cgroup/cpu.max': '150000 100000' }), 8).effectiveThreads,
    2,
  );
  assert.equal(
    cpuCapacity(
      fixture({
        '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '100000',
        '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
      }),
      8,
    ).effectiveThreads,
    1,
  );
  for (const values of [
    {},
    { '/sys/fs/cgroup/cpu.max': 'max 100000' },
    { '/sys/fs/cgroup/cpu.max': 'invalid 0' },
  ]) {
    const normal = cpuCapacity(fixture(values), 8);
    assert.equal(normal.effectiveThreads, 8);
    assert.deepEqual(localThreadOptions('', normal), {});
  }
  assert.equal(
    cpuCapacity(fixture({ '/sys/fs/cgroup/cpu.max': '800000 100000' }), 2).effectiveThreads,
    2,
  );
});
test('an explicit local thread choice is preserved and malformed configuration fails visibly', () => {
  assert.deepEqual(localThreadOptions('3'), { num_thread: 3 });
  for (const value of ['0', '-1', '1.5', '257', 'NaN'])
    assert.throws(() => localThreadOptions(value), /1 to 256/);
});
