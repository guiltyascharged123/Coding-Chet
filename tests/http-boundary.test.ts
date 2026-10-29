import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable loopback server, no account credentials, no model inference.
test('HTTP rejects untrusted authority and missing session before parsing bodies, while authorized writes work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-http-boundary-'));
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_PATH: join(directory, 'state.sqlite'),
      PORT: String(port),
      HOST: '127.0.0.1',
      WORKROOM_DEMO: '0',
      WORKROOM_CODEX_ENABLED: '0',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
      COMPATIBLE_API_URL: '',
      RUNNER_TOKEN: '',
      WORKROOM_ORIGIN: '',
      AGENT_PROVIDER: 'ollama',
      OLLAMA_URL: 'http://127.0.0.1:1',
    },
  });
  let logs = '';
  child.stdout.on('data', (b) => {
    logs += b;
  });
  child.stderr.on('data', (b) => {
    logs += b;
  });
  const http = (path: string, method = 'GET', headers: Record<string, string> = {}, body = '') =>
    new Promise<{ status: number; data: any; headers: import('node:http').IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
          let text = '';
          res.on('data', (b) => {
            text += b;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode!, data: JSON.parse(text), headers: res.headers }),
          );
        });
        req.on('error', reject);
        req.end(body);
      },
    );
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        ready = (await http('/api/health')).status === 200;
      } catch {
        /* starting */
      }
      if (ready) break;
      await delay(50);
    }
    assert.ok(ready, logs);
    const bad = {
      Host: `evil.invalid:${port}`,
      Origin: `http://evil.invalid:${port}`,
      'Content-Type': 'application/json',
    };
    assert.equal((await http('/api/state', 'GET', bad)).status, 403);
    assert.equal((await http('/api/policy', 'POST', bad, '{invalid')).status, 403);
    assert.equal(
      (await http('/api/policy', 'POST', { 'Content-Type': 'application/json' }, '{invalid'))
        .status,
      403,
    );
    const session = await http('/api/session');
    const headers = {
      Cookie: session.headers['set-cookie']![0].split(';')[0],
      'X-Workroom-CSRF': session.data.token,
      'Content-Type': 'application/json',
    };
    const state = await http('/api/state');
    assert.equal(
      (
        await http(
          '/api/policy',
          'POST',
          headers,
          JSON.stringify({ ...state.data.state.policy, maxRequests24h: 31 }),
        )
      ).status,
      200,
    );
    assert.equal((await http('/api/state')).data.state.policy.maxRequests24h, 31);
    assert.equal(
      (await http('/api/policy', 'POST', { ...headers, Origin: 'http://evil.invalid' }, '{}'))
        .status,
      403,
    );
    assert.equal(
      (await http('/api/policy', 'POST', { ...headers, 'Content-Encoding': 'gzip' }, '{}')).status,
      415,
    );
    assert.equal(
      (await http('/api/runner/claim', 'POST', { 'Content-Type': 'application/json' }, '{invalid'))
        .status,
      401,
    );
    const health = (await http('/api/health')).data;
    for (const field of ['buildId', 'configId', 'databaseId'])
      assert.match(health[field], /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(health).includes(directory), false);
  } finally {
    const exit = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exit;
    rmSync(directory, { recursive: true, force: true });
  }
});
