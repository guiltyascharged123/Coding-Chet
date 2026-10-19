import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'workroom-browser-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '3107',
    HOST: '127.0.0.1',
    DATABASE_PATH: join(directory, 'test.sqlite'),
    AGENT_PROVIDER: 'demo',
    DEMO_STEP_MS: '2000',
    RUNNER_TOKEN: 'browser-test-token-not-a-real-secret',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
child.on('exit', (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(code || 0);
});
