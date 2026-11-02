import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkCodingSandbox, codexCodingOptions, codexConfigArgs } from '../server/managed.js';
import { createServer, request } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Disposable loopback server, no account credentials, no model inference.
test('HTTP rejects untrusted authority and missing session before parsing bodies, while authorized writes work', async (t) => {
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
      WORKROOM_SETTINGS_ROOT: directory,
      HOME: directory,
      USERPROFILE: directory,
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
      401,
    );
    const pairingKey = readFileSync(join(directory, '.data', 'browser-access-key'), 'utf8');
    assert.equal((await http('/api/session')).status, 401);
    assert.equal((await http('/api/state')).status, 401);
    assert.equal((await http('/api/backup')).status, 401);
    for (const path of [
      '/API/session',
      '/api/SESSION',
      '/API/state',
      '/Api/backup',
      '/API/CONNECTIONS/settings',
    ])
      assert.equal((await http(path)).status, 401, path);
    assert.equal(
      (await http('/API/policy', 'POST', { 'Content-Type': 'application/json' }, '{invalid'))
        .status,
      401,
    );
    assert.equal(
      (await http('/API/runner/claim', 'POST', { 'Content-Type': 'application/json' }, '{invalid'))
        .status,
      401,
    );
    const session = await http('/api/session', 'GET', { Authorization: `Bearer ${pairingKey}` });
    const headers = {
      Cookie: session.headers['set-cookie']![0].split(';')[0],
      'X-Workroom-CSRF': session.data.token,
      'Content-Type': 'application/json',
    };
    const state = await http('/api/state', 'GET', headers);
    assert.equal(
      (
        await http(
          '/api/policy',
          'POST',
          headers,
          JSON.stringify({
            ...state.data.state.policy,
            maxRequests24h: 31,
            expectedRevision: state.data.state.policyRevision || 0,
          }),
        )
      ).status,
      200,
    );
    assert.equal((await http('/api/state', 'GET', headers)).data.state.policy.maxRequests24h, 31);
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
    assert.equal((await http('/api/connections/settings', 'GET', bad)).status, 403);
    assert.equal(
      (
        await http(
          '/api/connections/settings',
          'PUT',
          { 'Content-Type': 'application/json' },
          '{invalid',
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await http(
          '/api/connections/codex/login',
          'POST',
          { 'Content-Type': 'application/json' },
          '{}',
        )
      ).status,
      401,
    );
    const beforeIdentity = (await http('/api/health')).data;
    const settings = (await http('/api/connections/settings', 'GET', headers)).data;
    const secret = 'fixture-only-local-key';
    const saved = await http(
      '/api/connections/settings',
      'PUT',
      headers,
      JSON.stringify({
        provider: 'compatible',
        revision: settings.revision,
        model: 'local-fixture',
        url: 'http://127.0.0.1:1/v1',
        billing: 'local',
        apiKey: secret,
      }),
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.data.settings.compatible.hasKey, true);
    assert.equal(JSON.stringify(saved.data).includes(secret), false);
    assert.equal(
      (await http('/api/connections/settings', 'GET', headers)).headers['cache-control'],
      'no-store',
    );
    assert.equal(JSON.stringify((await http('/api/backup')).data).includes(secret), false);
    assert.equal((await http('/api/state', 'GET', headers)).data.state.policy.allowPaid, false);
    assert.equal((await http('/api/state', 'GET', headers)).data.connectionChange, undefined);
    assert.notEqual((await http('/api/health')).data.configId, beforeIdentity.configId);
    const conflict = await http(
      '/api/connections/settings',
      'PUT',
      headers,
      JSON.stringify({ provider: 'codex', revision: settings.revision, model: '', enabled: false }),
    );
    assert.equal(conflict.status, 409);
    assert.equal((await http('/api/state', 'GET', headers)).data.connectionChange, undefined);
    const health = (await http('/api/health')).data;
    for (const field of ['buildId', 'configId', 'databaseId'])
      assert.match(health[field], /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(health).includes(directory), false);
    await t.test(
      'a network-enabled native worker cannot read browser credentials or use the control API',
      async (t) => {
        const readiness = await checkCodingSandbox();
        if (!readiness.ready) {
          t.skip(readiness.message);
          return;
        }
        const projectDirectory = join(directory, 'project'),
          cliState = join(directory, 'isolated-cli-state');
        mkdirSync(projectDirectory);
        mkdirSync(cliState);
        const options = codexCodingOptions(projectDirectory, true);
        const entry = createRequire(import.meta.resolve('@openai/codex-sdk')).resolve(
          '@openai/codex/bin/codex.js',
        );
        const script = `(async()=>{
        const fs=require('node:fs'),assert=require('node:assert/strict');
        assert.throws(()=>fs.readFileSync(${JSON.stringify(join(directory, '.data', 'browser-access-key'))}),error=>['EACCES','EPERM','ENOENT'].includes(error.code));
        const base=${JSON.stringify(`http://127.0.0.1:${port}`)};
        for(const path of ['/api/session','/api/backup','/api/state','/api/connections/settings'])assert.equal((await fetch(base+path)).status,401,path);
        assert.equal((await fetch(base+'/api/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({maxConcurrent:4})})).status,401);
        assert.equal((await fetch(base+'/api/projects/other-project/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
      })().catch(error=>{console.error(error);process.exitCode=1;});`;
        const native = spawnSync(
          process.env.WORKROOM_CODEX_BIN || process.execPath,
          [
            ...(process.env.WORKROOM_CODEX_BIN ? [] : [entry]),
            'sandbox',
            '--permission-profile',
            'workroom_coding',
            '--cd',
            projectDirectory,
            ...codexConfigArgs(options),
            '--',
            process.execPath,
            '-e',
            script,
          ],
          {
            cwd: projectDirectory,
            env: { ...options.env, CODEX_HOME: cliState },
            encoding: 'utf8',
            timeout: 20000,
            windowsHide: true,
          },
        );
        assert.equal(
          native.status,
          0,
          native.stderr || String(native.error || 'Native isolation probe failed'),
        );
        assert.equal(
          (await http('/api/state', 'GET', headers)).data.state.policy.maxConcurrent,
          state.data.state.policy.maxConcurrent,
        );
      },
    );
  } finally {
    const exit = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exit;
    rmSync(directory, { recursive: true, force: true });
  }
});
