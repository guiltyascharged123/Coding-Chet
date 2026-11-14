import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardwareSnapshot, modelAdvice } from '../scripts/local-hardware.mjs';

const GiB = 1024 ** 3;
test('hardware advice handles insufficient resources, actual model sizes and unknown tags without silently choosing a model', () => {
  const host = { availableMemoryBytes: 2 * GiB, freeDiskBytes: 1 * GiB };
  const small = modelAdvice('example/qwen:4B', host);
  assert.equal(small.model, 'example/qwen:4B');
  assert.equal(small.warnings.length, 2);
  assert.equal(small.estimateOnly, true);
  const installed = modelAdvice('custom:latest', host, 5 * GiB);
  assert.equal(installed.estimatedWeightBytes, 5 * GiB);
  assert.equal(installed.warnings.length, 1, 'installed weights need no download');
  const unknown = modelAdvice('custom:latest', host);
  assert.equal(unknown.estimatedRuntimeBytes, null);
  assert.deepEqual(unknown.warnings, []);
  assert.deepEqual(
    modelAdvice('qwen:4B', { availableMemoryBytes: 32 * GiB, freeDiskBytes: null }).warnings,
    [],
  );
});

test('hardware inspection reports the actual host without requiring GPU tools or an existing model', () => {
  const snapshot = hardwareSnapshot(process.cwd());
  assert.ok(snapshot.cpuThreads > 0);
  assert.ok(snapshot.memoryBytes > 0);
  assert.ok(snapshot.availableMemoryBytes <= snapshot.memoryBytes);
  assert.ok(snapshot.freeDiskBytes === null || snapshot.freeDiskBytes >= 0);
  assert.equal(hardwareSnapshot('/does-not-exist').freeDiskBytes, null);
});
