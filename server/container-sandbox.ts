import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
export const containerInfo = {
  ready: false,
  message: 'Isolated Linux execution has not been checked.',
  image: process.env.WORKROOM_SANDBOX_IMAGE || 'node:24-alpine',
};
let imageId = '';
let refreshGeneration = 0;
export function containerCapabilityIssue(info: {
  SecurityOptions?: string[];
  CgroupVersion?: string;
  MemoryLimit?: boolean;
  CPUCfsQuota?: boolean;
  PidsLimit?: boolean;
}) {
  if (!info.SecurityOptions?.includes('name=rootless'))
    return 'Use a rootless Docker daemon under the Workroom user account.';
  if (
    !info.SecurityOptions.some(
      (s) => s.startsWith('name=seccomp') && !/(?:^|,)profile=unconfined(?:,|$)/.test(s),
    )
  )
    return 'Docker seccomp protection must be enabled.';
  if (info.CgroupVersion !== '2' || !info.MemoryLimit || !info.CPUCfsQuota || !info.PidsLimit)
    return 'Docker cannot enforce memory, CPU and process budgets on this host. Configure rootless Docker with delegated cgroup v2 controllers; autonomous execution is blocked.';
  return undefined;
}
export function containerResourceCheck(resources: {
  memory: number;
  cpus: number;
  processes: number;
}) {
  return `const resourceFs=require('node:fs'); const b=${JSON.stringify(resources)};
const mem=resourceFs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids=resourceFs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu=resourceFs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(/\\s+/);
if(mem==='max'||pids==='max'||cpu[0]==='max'||!Number(mem)||!Number(pids)||!Number(cpu[0])||!Number(cpu[1])||Number(mem)>b.memory||Number(pids)>b.processes||Number(cpu[0])/Number(cpu[1])>b.cpus+0.000001)throw Error('Actual container resource controls do not enforce the configured budgets. No model-selected code was run.');\n`;
}

export async function refreshContainerInfo() {
  const generation = ++refreshGeneration;
  const next = {
    ready: false,
    message: '',
    image: process.env.WORKROOM_SANDBOX_IMAGE || 'node:24-alpine',
  };
  let nextImageId = '';
  try {
    const { stdout } = await exec('docker', ['info', '--format', '{{json .}}'], {
      timeout: 5000,
    });
    const issue = containerCapabilityIssue(JSON.parse(stdout));
    if (issue) throw new Error(issue);
    const image = await exec('docker', ['image', 'inspect', next.image, '--format', '{{.Id}}'], {
      timeout: 5000,
    });
    nextImageId = image.stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(nextImageId))
      throw new Error('The sandbox image could not be resolved.');
    next.ready = true;
    next.message = `Rootless Docker, cgroup resource controls and ${next.image} are available. Jobs run offline with a read-only system. Each job checks its actual resource controls before running model-selected code. This check did not run a model.`;
  } catch (error) {
    next.message = `Isolated execution unavailable: ${error instanceof Error ? error.message : 'Docker check failed'}. Install rootless Docker and pull ${next.image}, then refresh Model connections. No host-command fallback is used.`;
  }
  if (generation === refreshGeneration) {
    Object.assign(containerInfo, next);
    imageId = next.ready ? nextImageId : '';
  }
  return containerInfo;
}

export type SandboxAction =
  | { action: 'run'; id: string; command: string }
  | { action: 'read'; id: string; path: string }
  | { action: 'write'; id: string; path: string; content: string };
export type SandboxReply = { output: string; exitCode: number; changed?: boolean };
export type SandboxBudget = {
  timeoutSeconds?: number;
  memoryMb?: number;
  cpus?: number;
  processes?: number;
  tempMb?: number;
};

function sandboxName(root: string, actionId: string) {
  return `workroom-${createHash('sha256')
    .update(realpathSync(root) + '\0' + actionId)
    .digest('hex')
    .slice(0, 32)}`;
}
export async function stopSandboxAction(root: string, actionId: string) {
  try {
    await exec('docker', ['rm', '--force', sandboxName(root, actionId)], { timeout: 5000 });
  } catch (error) {
    if (
      !/No such container|not found/i.test(String((error as { stderr?: string }).stderr || error))
    )
      throw error;
  }
}

const fileProgram = `
const fs = require('node:fs'), path = require('node:path');
let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const a = JSON.parse(input); let p = '/project';
  for (const part of a.path.split('/')) {
    p = path.join(p, part);
    try { if (fs.lstatSync(p).isSymbolicLink()) throw Error('Symlink paths are not allowed.'); }
    catch(e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (a.action === 'read') {
    const f = fs.openSync(p, 'r');
    const b = Buffer.alloc(16000); const n = fs.readSync(f,b,0,b.length,0); fs.closeSync(f);
    process.stdout.write(b.subarray(0,n));
    if (fs.statSync(p).size > n) process.stdout.write('\\n[File excerpt: first '+n+' bytes; use a bounded command to inspect further.]');
  } else {
    const changed = !fs.existsSync(p) || fs.readFileSync(p,'utf8') !== a.content;
    fs.mkdirSync(path.dirname(p), {recursive:true});
    fs.writeFileSync(p,a.content);
    process.stdout.write(JSON.stringify({changed, path:a.path, bytes:Buffer.byteLength(a.content)}));
  }
});`;

export async function sandboxAction(
  root: string,
  action: SandboxAction,
  signal: AbortSignal,
  readOnly = false,
  budget: SandboxBudget = {},
): Promise<SandboxReply> {
  if (!containerInfo.ready || !imageId) throw new Error(containerInfo.message);
  signal.throwIfAborted();
  if (readOnly && action.action === 'write')
    return {
      output:
        'This assignment is read-only. Inspect files or delegate the required implementation to a writable specialist.',
      exitCode: 2,
    };
  if (
    action.action !== 'run' &&
    (!action.path ||
      action.path.length > 240 ||
      action.path.includes('\\') ||
      action.path.startsWith('/') ||
      action.path.split('/').some((p) => !p || p === '.' || p === '..'))
  )
    return { output: 'Use a project-relative file path without traversal.', exitCode: 2 };
  const directory = realpathSync(root);
  if (directory.includes(',')) throw new Error('The project folder path cannot contain a comma.');
  const name = sandboxName(root, action.id);
  const resources = {
    memory: (budget.memoryMb ?? 512) * 1048576,
    cpus: budget.cpus ?? 1,
    processes: budget.processes ?? 128,
  };
  const verifyResources = containerResourceCheck(resources);
  const args = [
    'run',
    '--rm',
    '--pull=never',
    '--name',
    name,
    '--network',
    'none',
    '--cgroupns=private',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--pids-limit=${budget.processes ?? 128}`,
    `--memory=${budget.memoryMb ?? 512}m`,
    `--cpus=${budget.cpus ?? 1}`,
    '--tmpfs',
    `/tmp:rw,nosuid,nodev,size=${(budget.tempMb ?? 64) * 1048576}`,
    '--mount',
    `type=bind,src=${directory},dst=/project${readOnly ? ',readonly' : ''}`,
    '--workdir',
    '/project',
    '--env',
    'HOME=/tmp',
    '--interactive',
    imageId,
    // This deadline survives the controlling Workroom process crashing.
    ...((budget.timeoutSeconds || 0) > 0
      ? ['timeout', '-s', 'KILL', String(budget.timeoutSeconds)]
      : []),
    ...(action.action === 'run'
      ? [
          'node',
          '-e',
          verifyResources +
            `const r=require('node:child_process').spawnSync('sh',['-c',process.argv[1]],{stdio:'inherit'});process.exit(r.status ?? 1);`,
          '--',
          action.command,
        ]
      : ['node', '-e', verifyResources + fileProgram]),
  ];
  return runContainerProcess(
    name,
    args,
    action.action === 'run' ? undefined : JSON.stringify(action),
    signal,
    budget.timeoutSeconds || 0,
    action.action === 'write',
  );
}

export interface ContainerDriver {
  spawn(args: string[]): ChildProcessWithoutNullStreams;
  remove(name: string): Promise<unknown>;
}
export class ContainerShutdownError extends Error {
  constructor(cause: unknown) {
    super(
      'Container shutdown could not be confirmed. A command may still be running. Inspect Docker and explicitly retry this task before further work.',
      { cause },
    );
  }
}
const defaultDriver: ContainerDriver = {
  spawn: (args) => spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] }),
  remove: async (name) => {
    try {
      await exec('docker', ['rm', '--force', name], { timeout: 5000 });
    } catch (error) {
      if (
        !/No such container|not found/i.test(String((error as { stderr?: string }).stderr || error))
      )
        throw error;
    }
  },
};

/** Process lifecycle is separate from capability checks so shutdown behavior can
 * be tested without relaxing the production sandbox or running a live model. */
export function runContainerProcess(
  name: string,
  args: string[],
  input: string | undefined,
  signal: AbortSignal,
  timeoutSeconds: number,
  writeAction = false,
  driver: ContainerDriver = defaultDriver,
): Promise<SandboxReply> {
  return new Promise((resolve, reject) => {
    const child = driver.spawn(args);
    let output = '',
      bytes = 0,
      stopping = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let shutdown: Promise<{ error?: unknown }> | undefined;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      // Removing the container stops its entire process tree. Never kill only
      // the Docker client and leave an agent process running in the background.
      shutdown = Promise.resolve()
        .then(() => driver.remove(name))
        .then(
          () => ({}),
          (error) => ({ error }),
        )
        .finally(() => {
          child.kill('SIGKILL');
        });
    };
    const collect = (chunk: Buffer) => {
      const remaining = Math.max(0, 64000 - bytes);
      if (remaining) output += chunk.subarray(0, remaining).toString('utf8');
      bytes += chunk.length;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.stdin.on('error', () => {});
    child.on('error', reject);
    if (timeoutSeconds) {
      const deadline = Date.now() + timeoutSeconds * 1000;
      const check = () => {
        const left = deadline - Date.now();
        if (left <= 0) stop();
        else timer = setTimeout(check, Math.min(left, 60000));
      };
      check();
    }
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.on('close', async (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      const cleanup = await shutdown;
      if (cleanup && 'error' in cleanup) return reject(new ContainerShutdownError(cleanup.error));
      if (signal.aborted)
        return reject(
          new Error(
            'Sandbox action cancelled; inspect the project for partial work before retrying.',
          ),
        );
      if (stopping)
        return resolve({
          output:
            output.slice(0, 16000) +
            '\n[Stopped at the configured action deadline. Inspect partial work.]',
          exitCode: 124,
        });
      let changed: boolean | undefined;
      if (writeAction && code === 0) {
        try {
          changed = JSON.parse(output).changed === true;
        } catch {}
      }
      resolve({
        output:
          output.slice(0, 16000) +
          (bytes > 16000
            ? '\n[Output excerpt; redirect verbose output to a project file to inspect further.]'
            : ''),
        exitCode: code ?? 1,
        changed,
      });
    });
    child.stdin.end(input);
  });
}
