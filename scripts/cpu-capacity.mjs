import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

export function cpuCapacity(read = readFileSync, affinity = availableParallelism()) {
  let quotaCores = null;
  try {
    const [quota, period] = read('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max' && Number(quota) > 0 && Number(period) > 0)
      quotaCores = Number(quota) / Number(period);
  } catch {
    try {
      const quota = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'));
      const period = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'));
      if (quota > 0 && period > 0) quotaCores = quota / period;
    } catch {
      /* Not a Linux cgroup host; affinity remains authoritative. */
    }
  }
  if (!Number.isFinite(quotaCores) || quotaCores <= 0) quotaCores = null;
  return {
    affinityThreads: affinity,
    quotaCores,
    effectiveThreads: Math.max(
      1,
      Math.min(affinity, quotaCores === null ? affinity : Math.ceil(quotaCores)),
    ),
  };
}

export function localThreadOptions(
  value = process.env.OLLAMA_NUM_THREADS,
  capacity = cpuCapacity(),
) {
  if (value !== undefined && value !== '') {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 256)
      throw new Error('OLLAMA_NUM_THREADS must be an integer from 1 to 256.');
    return { num_thread: Number(value) };
  }
  // Ollama's hardware default stays in charge outside a detected quota.
  return capacity.quotaCores !== null ? { num_thread: capacity.effectiveThreads } : {};
}
