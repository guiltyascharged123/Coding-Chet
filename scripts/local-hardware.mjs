import { totalmem, freemem, availableParallelism } from 'node:os';
import { statfsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const GiB = 1024 ** 3;
export function hardwareSnapshot(root) {
  const constraint = process.constrainedMemory?.() || totalmem();
  let freeDiskBytes = null;
  try {
    const disk = statfsSync(root);
    freeDiskBytes = disk.bavail * disk.bsize;
  } catch {
    /* Unknown is not zero and must not block a configured endpoint. */
  }
  return {
    cpuThreads: availableParallelism(),
    memoryBytes: Math.min(totalmem(), constraint),
    availableMemoryBytes: Math.min(freemem(), process.availableMemory?.() ?? freemem(), constraint),
    freeDiskBytes,
    gpu: 'Not detected by this check. Ollama /api/ps reports actual GPU offload after loading.',
  };
}

export function modelAdvice(model, hardware, installedBytes) {
  const match = model.match(/(?:^|[:/\-_])(\d+(?:\.\d+)?)b(?:$|[:_\-])/i);
  const parameters = match ? Number(match[1]) : null;
  // A tag is not a model manifest. Treat this as an advisory estimate only.
  const weights = installedBytes > 0 ? installedBytes : parameters ? parameters * 0.65 * GiB : null;
  const runtime = weights ? weights + 3 * GiB : null;
  const warnings = [];
  if (runtime && hardware.availableMemoryBytes < runtime)
    warnings.push(
      'Available RAM is below the rough CPU inference estimate. Close other applications, reduce context, or explicitly choose a smaller model. GPU offload may change this estimate.',
    );
  if (
    !installedBytes &&
    weights &&
    hardware.freeDiskBytes !== null &&
    hardware.freeDiskBytes < weights * 1.2
  )
    warnings.push(
      'Free disk space may be insufficient for download and temporary files. Free space before pulling weights.',
    );
  return {
    model,
    estimatedWeightBytes: weights,
    estimatedRuntimeBytes: runtime,
    estimateOnly: true,
    warnings,
  };
}

export function printHardwareAdvice(root, model, installedBytes) {
  const hardware = hardwareSnapshot(root);
  const advice = modelAdvice(model, hardware, installedBytes);
  console.log(JSON.stringify({ hardware, advice }, null, 2));
  return { hardware, advice };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  printHardwareAdvice(
    resolve(import.meta.dirname, '..'),
    process.env.OLLAMA_MODEL || 'huihui_ai/qwen3.5-abliterated:4B',
  );
