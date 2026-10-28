import { spawn } from 'node:child_process';
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  readlinkSync,
  existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
mkdirSync('.data', { recursive: true });
if (existsSync('.env')) process.loadEnvFile('.env');
const port = process.env.PORT || '3001';
const workspaceId = createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16);
async function health() {
  try {
    const result = await (
      await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) })
    ).json();
    return result.ok && result.mode === 'workspace' && result.workspaceId === workspaceId;
  } catch {
    return false;
  }
}
if (process.argv.includes('--restart')) {
  const pidFile = `.data/codespace-${port}.pid`;
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    if (!Number.isInteger(pid) || pid < 2)
      throw new Error('The saved Workroom process ID is invalid.');
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const absoluteLauncher = resolve(root, 'scripts/launch.mjs');
      const belongsHere =
        args.includes(absoluteLauncher) ||
        (args.includes('scripts/launch.mjs') &&
          resolve(readlinkSync(`/proc/${pid}/cwd`)) === resolve(root));
      if (!belongsHere)
        throw new Error(
          'The saved process is not this workspace’s workspace launcher. Stop Workroom in its terminal and try again.',
        );
      process.kill(pid, 'SIGTERM');
      for (let attempt = 0; attempt < 40 && (await health()); attempt++) await delay(250);
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
    }
  }
  if (await health())
    throw new Error(
      'Workroom is still running outside this helper. Stop it with Ctrl+C in its terminal, then run npm run local.',
    );
}
if (await health()) {
  console.log(`Workroom is already ready. Open its forwarded port (${port}), then click Run team.`);
  process.exit(0);
}
const log = openSync('.data/codespace.log', 'a');
const child = spawn(process.execPath, [resolve(root, 'scripts/launch.mjs'), '--workspace'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    WORKROOM_NO_OPEN: '1',
    WORKROOM_LOCAL_SETUP: process.env.WORKROOM_CLOUD_LOCAL_SETUP || '0',
  },
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
let stopped = false;
child.on('exit', () => {
  stopped = true;
});
writeFileSync(`.data/codespace-${port}.pid`, String(child.pid));
child.unref();
closeSync(log);
let ready = false;
for (let attempt = 0; attempt < 120 && !stopped; attempt++) {
  if (await health()) {
    ready = true;
    break;
  }
  await delay(500);
}
if (ready)
  console.log(
    `Workroom is ready. Open the forwarded Workroom port (${port}), then click Run team.`,
  );
else {
  console.error(readFileSync('.data/codespace.log', 'utf8').split('\n').slice(-25).join('\n'));
  console.error(
    'Workroom did not become ready. Run npm run local in the terminal to see the error.',
  );
  process.exitCode = 1;
}
