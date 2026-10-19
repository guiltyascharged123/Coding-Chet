import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
mkdirSync('.data', { recursive: true });
const port = process.env.WORKROOM_DEMO_PORT || '3000';
const workspaceId = createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16);
async function health() {
  try {
    const result = await (
      await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) })
    ).json();
    return result.ok && result.mode === 'demo' && result.workspaceId === workspaceId;
  } catch {
    return false;
  }
}
if (await health()) {
  console.log(`Workroom is already ready. Open its forwarded port (${port}), then click Run team.`);
  process.exit(0);
}
const log = openSync('.data/codespace.log', 'a');
const child = spawn(process.execPath, ['scripts/launch.mjs'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', log, log],
  env: { ...process.env, WORKROOM_NO_OPEN: '1' },
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
    `Workroom is ready. Open the forwarded Workroom demo port (${port}), then click Run team.`,
  );
else {
  console.error(readFileSync('.data/codespace.log', 'utf8').split('\n').slice(-25).join('\n'));
  console.error(
    'Workroom did not become ready. Run npm run demo in the terminal to see the error.',
  );
  process.exitCode = 1;
}
