import '../server/network.js';
import 'dotenv/config';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, release } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  containerCapabilityIssue,
  refreshContainerInfo,
  sandboxAction,
} from '../server/container-sandbox.js';
import { dockerConnection } from '../server/docker-runtime.js';

const execute = promisify(execFile);
export const INSTALLER_URL =
  'https://raw.githubusercontent.com/docker/docker-install/8ad27bd3ac871feabe62f1d926c4067800c1732f/rootless-install.sh';
export const INSTALLER_SHA256 = 'cfee984e1a9e5e337a692af12c543889f126e9b88b4d2f90445e10bc4255583b';
export const DOCKER_VERSION = '29.10.0';
const TOOL_IMAGE = 'workroom-tools:local';
type Run = (command: string, args: string[], inherit?: boolean) => Promise<string>;

export function workspacePrerequisites(exists: (path: string) => boolean = existsSync) {
  return {
    systemd: exists('/run/systemd/system'),
    cgroupV2: exists('/sys/fs/cgroup/cgroup.controllers'),
  };
}

export function workspacePrerequisiteIssue(facts: ReturnType<typeof workspacePrerequisites>) {
  if (facts.systemd && facts.cgroupV2) return undefined;
  const details = facts.systemd
    ? 'systemd is running, but cgroup v2 is not active. Ubuntu 20.04 commonly uses the older cgroup layout; enable cgroup v2 in its boot configuration, rather than installing systemd or replacing the laptop.'
    : facts.cgroupV2
      ? 'cgroup v2 is available, but systemd is not running in this environment. For WSL, enable systemd in /etc/wsl.conf and restart WSL; for a container/chroot, run setup on the Ubuntu host or in a systemd-enabled VM.'
      : 'Neither a running systemd installation nor a cgroup v2 mount was detected. Identify whether this is WSL, a container/chroot or a full Ubuntu installation before changing its configuration.';
  const section = facts.systemd
    ? 'ubuntu-2004-cgroup-v2-activation'
    : 'ubuntu-setup-troubleshooting';
  return `${details}\nSee docs/AUTONOMOUS-EXECUTION.md#${section}. Nothing was installed or reconfigured.`;
}

function printHostDiagnostics() {
  const facts = workspacePrerequisites();
  let pid1 = 'unavailable';
  try {
    pid1 = readFileSync('/proc/1/comm', 'utf8').trim();
  } catch {
    /* Not Linux. */
  }
  console.log(
    `Kernel: ${release()}\nPID 1: ${pid1}\nsystemd running: ${facts.systemd ? 'yes' : 'no'}\ncgroup v2 active: ${facts.cgroupV2 ? 'yes' : 'no'}`,
  );
  console.log(
    workspacePrerequisiteIssue(facts) ||
      'Installer prerequisites are present. Docker resource enforcement and the isolated execution test must still pass.',
  );
}

const run: Run = async (command, args, inherit = false) => {
  const env = dockerConnection().env;
  if (!inherit)
    return (
      await execute(command, args, { env, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576 })
    ).stdout;
  await new Promise<void>((done, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? done()
        : reject(
            new Error(
              `${command} ${signal ? `stopped (${signal})` : `failed (${code})`}. Review its message above.`,
            ),
          ),
    );
  });
  return '';
};

function executable(name: string) {
  for (const entry of (dockerConnection().env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = resolve(entry, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) return candidate;
    } catch {
      /* Try the next PATH entry. */
    }
  }
}

export function verifyInstaller(bytes: Uint8Array) {
  if (createHash('sha256').update(bytes).digest('hex') !== INSTALLER_SHA256)
    throw new Error(
      'Docker installer checksum did not match the reviewed version. Nothing was executed.',
    );
}

async function downloadInstaller() {
  const response = await fetch(INSTALLER_URL, {
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  if (!response.ok || !response.body)
    throw new Error(`Could not download the official Docker installer (HTTP ${response.status}).`);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 131072)
        throw new Error('The Docker installer exceeded its expected size. Nothing was executed.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks);
  verifyInstaller(bytes);
  return bytes;
}

/** Only these three setup keys change. Credentials and the selected model remain intact. */
export function saveWorkspaceSettings(
  root: string,
  settings: Record<
    'WORKROOM_DOCKER_BIN' | 'WORKROOM_DOCKER_HOST' | 'WORKROOM_SANDBOX_IMAGE',
    string
  >,
) {
  const path = join(root, '.env');
  if (existsSync(path) && !lstatSync(path).isFile())
    throw new Error(
      'Your .env is linked or is not a regular file. Keep it intact and add the workspace settings manually.',
    );
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const keys = new Set(Object.keys(settings));
  const kept = previous
    .split(/\r?\n/)
    .filter((line) => !keys.has(line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/)?.[1] || ''))
    .join('\n')
    .replace(/\n*$/, '');
  const text =
    kept +
    '\n' +
    Object.entries(settings)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') +
    '\n';
  const temporary = join(root, `.env.workspace-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    if ((existsSync(path) ? readFileSync(path, 'utf8') : '') !== previous)
      throw new Error(
        'Your settings changed during setup. Nothing was overwritten; run setup again.',
      );
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function workspaceSmokeTest(root: string) {
  const parent = join(root, '.data');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(parent, 'workspace-check-'));
  const project = join(directory, 'project');
  mkdirSync(project, { mode: 0o700 });
  const sentinel = `outside-${randomUUID()}`;
  writeFileSync(join(directory, sentinel), 'synthetic host-only file', { mode: 0o600 });
  const previous = process.env.WORKROOM_SETUP_CANARY;
  process.env.WORKROOM_SETUP_CANARY = randomUUID();
  const source = `const fs=require('node:fs'),assert=require('node:assert/strict');
assert.equal(process.env.WORKROOM_SETUP_CANARY,undefined,'Host environment leaked');
assert.equal(fs.existsSync('/var/run/docker.sock'),false,'Docker socket exposed');
assert.equal(fs.existsSync(${JSON.stringify(join(directory, sentinel))}),false,'Host path exposed');
assert.equal(fs.existsSync('/project/${sentinel}'),false,'Parent mounted instead of project');
assert.equal(fs.existsSync('/${sentinel}'),false,'Parent folder exposed');
assert.equal(fs.existsSync('/project/../${sentinel}'),false,'Project boundary escaped');
fs.writeFileSync('result.txt','workspace-ok');
console.log('Code executed; host-only sentinel, host environment and Docker socket stayed outside.');`;
  try {
    for (const action of [
      { action: 'write' as const, path: 'check.cjs', content: source },
      { action: 'run' as const, command: 'node check.cjs' },
      { action: 'read' as const, path: 'result.txt' },
    ]) {
      const result = await sandboxAction(
        project,
        { ...action, id: randomUUID() },
        AbortSignal.timeout(60000),
      );
      if (result.exitCode !== 0) throw new Error(`Execution smoke test failed: ${result.output}`);
      if (action.action === 'read' && result.output !== 'workspace-ok')
        throw new Error('Project files did not persist across tool actions.');
    }
    if (readFileSync(join(project, 'result.txt'), 'utf8') !== 'workspace-ok')
      throw new Error('The execution result was not saved in the intended project folder.');
  } finally {
    if (previous === undefined) delete process.env.WORKROOM_SETUP_CANARY;
    else process.env.WORKROOM_SETUP_CANARY = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

type Dependencies = {
  run: Run;
  executable: typeof executable;
  exists: (path: string) => boolean;
  download: typeof downloadInstaller;
  refresh: typeof refreshContainerInfo;
  smoke: typeof workspaceSmokeTest;
  log: (line: string) => void;
  platform: string;
  uid: number;
  home: string;
};

export async function setupWorkspace(
  root: string,
  checkOnly = false,
  overrides: Partial<Dependencies> = {},
) {
  const d: Dependencies = {
    run,
    executable,
    exists: existsSync,
    download: downloadInstaller,
    refresh: refreshContainerInfo,
    smoke: workspaceSmokeTest,
    log: console.log,
    platform: process.platform,
    uid: process.getuid?.() ?? -1,
    home: homedir(),
    ...overrides,
  };
  if (d.platform !== 'linux')
    throw new Error(
      'This installer supports Linux/Ubuntu. Run it in the Ubuntu instance where Workroom runs.',
    );
  if (d.uid === 0)
    throw new Error(
      'Run npm run setup:workspace as your normal Ubuntu user, without sudo. Only prerequisite package installation uses sudo.',
    );
  let binary = process.env.WORKROOM_DOCKER_BIN || d.executable('docker');
  const runtimeDirectory = process.env.XDG_RUNTIME_DIR || `/run/user/${d.uid}`;
  const socket = join(runtimeDirectory, 'docker.sock');
  if (!process.env.WORKROOM_DOCKER_HOST && d.exists(socket))
    process.env.WORKROOM_DOCKER_HOST = `unix://${socket}`;
  const probe = async () => {
    if (!binary) return undefined;
    try {
      return JSON.parse(await d.run(binary, ['info', '--format', '{{json .}}']));
    } catch {
      return undefined;
    }
  };
  let info = await probe();
  if (!info?.SecurityOptions?.includes('name=rootless')) {
    if (checkOnly)
      throw new Error(
        'A running rootless Docker service was not found. Run npm run setup:workspace to install and prepare it.',
      );
    const prerequisiteIssue = workspacePrerequisiteIssue(workspacePrerequisites(d.exists));
    if (prerequisiteIssue) throw new Error(prerequisiteIssue);
    const missing = ['curl', 'newuidmap', 'newgidmap', 'iptables', 'slirp4netns'].some(
      (name) => !d.executable(name),
    );
    if (missing) {
      if (!d.executable('apt-get'))
        throw new Error(
          'Install curl, uidmap, iptables, slirp4netns and dbus-user-session using your distribution package manager, then rerun setup.',
        );
      d.log(
        'Installing Ubuntu prerequisites. Ubuntu may ask for your sudo password in this terminal.',
      );
      await d.run('sudo', ['apt-get', 'update'], true);
      await d.run(
        'sudo',
        [
          'apt-get',
          'install',
          '-y',
          'curl',
          'ca-certificates',
          'uidmap',
          'dbus-user-session',
          'iptables',
          'slirp4netns',
          'fuse-overlayfs',
        ],
        true,
      );
    }
    try {
      await d.run('systemctl', ['--user', 'is-active', 'default.target']);
    } catch {
      throw new Error(
        'Your Ubuntu user session is not available to systemd. Log out and back in as your normal user, then run npm run setup:workspace again.',
      );
    }
    let context: string | undefined;
    if (binary) {
      const names = ['WORKROOM_DOCKER_HOST', 'DOCKER_HOST', 'DOCKER_CONTEXT'];
      const before = names.map((name) => process.env[name]);
      try {
        names.forEach((name) => delete process.env[name]);
        context = (await d.run(binary, ['context', 'show'])).trim();
      } catch {
        throw new Error(
          'Could not read your existing Docker context. Fix the Docker CLI first; setup will not replace an unknown Docker configuration.',
        );
      } finally {
        names.forEach((name, index) => {
          if (before[index] === undefined) delete process.env[name];
          else process.env[name] = before[index];
        });
      }
    }
    try {
      const tool = d.executable('dockerd-rootless-setuptool.sh');
      if (tool) await d.run(tool, ['install', '--force'], true);
      else {
        d.log('Installing the reviewed official Docker rootless installer into your user account.');
        const bytes = await d.download();
        verifyInstaller(bytes);
        const temporary = mkdtempSync(join(root, '.workspace-install-'));
        const names = [
          'LOAD_SCRIPT_COMMIT_SHA',
          'LOAD_SCRIPT_STABLE_LATEST',
          'CHANNEL',
          'FORCE_ROOTLESS_INSTALL',
          'XDG_RUNTIME_DIR',
        ];
        const before = names.map((name) => process.env[name]);
        try {
          const file = join(temporary, 'rootless-install.sh');
          writeFileSync(file, bytes, { mode: 0o600 });
          Object.assign(process.env, {
            LOAD_SCRIPT_COMMIT_SHA: '8ad27bd3ac871feabe62f1d926c4067800c1732f',
            LOAD_SCRIPT_STABLE_LATEST: DOCKER_VERSION,
            CHANNEL: 'stable',
            FORCE_ROOTLESS_INSTALL: '1',
            XDG_RUNTIME_DIR: runtimeDirectory,
          });
          await d.run('sh', [file], true);
        } finally {
          names.forEach((name, index) => {
            if (before[index] === undefined) delete process.env[name];
            else process.env[name] = before[index];
          });
          rmSync(temporary, { recursive: true, force: true });
        }
      }
    } finally {
      if (context) await d.run(binary!, ['context', 'use', context]);
    }
    binary = d.exists(join(d.home, 'bin', 'docker'))
      ? join(d.home, 'bin', 'docker')
      : d.executable('docker');
    if (!binary)
      throw new Error(
        'The Docker CLI was not installed successfully. Review the installer output above.',
      );
    process.env.WORKROOM_DOCKER_HOST = `unix://${socket}`;
    await d.run('systemctl', ['--user', 'start', 'docker'], true);
    info = await probe();
    if (!info)
      throw new Error(
        'Rootless Docker did not start. Run systemctl --user status docker and review its error; setup did not claim success.',
      );
  }
  const issue = containerCapabilityIssue(info);
  if (issue)
    throw new Error(
      `${issue}\nSee docs/AUTONOMOUS-EXECUTION.md#ubuntu-setup-troubleshooting for the targeted cgroup/user-session fix. No agent code was executed.`,
    );
  process.env.WORKROOM_DOCKER_BIN = binary!;
  if (!process.env.WORKROOM_DOCKER_HOST) {
    const endpoint = (
      await d.run(binary!, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
    ).trim();
    if (!endpoint.startsWith('unix://'))
      throw new Error('Use a local rootless Docker socket for this project workspace.');
    process.env.WORKROOM_DOCKER_HOST = endpoint;
  }
  const image = process.env.WORKROOM_SANDBOX_IMAGE || (checkOnly ? 'node:24-alpine' : TOOL_IMAGE);
  process.env.WORKROOM_SANDBOX_IMAGE = image;
  if (!checkOnly) {
    if (image === TOOL_IMAGE) {
      d.log(
        'Preparing the project tools image: Node.js, Python, Git, SQLite and command-line utilities.',
      );
      await d.run(
        binary!,
        [
          'build',
          '--tag',
          image,
          '--file',
          join(root, 'sandbox', 'Dockerfile'),
          join(root, 'sandbox'),
        ],
        true,
      );
    } else {
      try {
        await d.run(binary!, ['image', 'inspect', image]);
      } catch {
        await d.run(binary!, ['pull', image], true);
      }
    }
  }
  const checked = await d.refresh();
  if (!checked.ready) throw new Error(checked.message);
  d.log('Checking actual isolated code execution and persistent project files…');
  await d.smoke(root);
  if (!checkOnly)
    saveWorkspaceSettings(root, {
      WORKROOM_DOCKER_BIN: binary!,
      WORKROOM_DOCKER_HOST: process.env.WORKROOM_DOCKER_HOST!,
      WORKROOM_SANDBOX_IMAGE: image,
    });
  d.log(
    'Workspace verified: code runs, project files persist, and the host-only test file, host environment and Docker socket stay outside.',
  );
  d.log(
    checkOnly
      ? 'No packages, images or settings were changed.'
      : 'Setup complete. Restart Workroom with npm run local, then retry the saved project. Your model connection was not changed.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--diagnose')) printHostDiagnostics();
  else
    setupWorkspace(
      fileURLToPath(new URL('../', import.meta.url)),
      process.argv.includes('--check'),
    ).catch((error) => {
      console.error(`Workspace setup: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
