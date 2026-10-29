import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeIdentity, runtimeMatches } from '../scripts/runtime-identity.mjs';

test('runtime reuse requires matching immutable source, database and effective configuration identities', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workroom-runtime-'));
  try {
    mkdirSync(join(directory, 'server'));
    writeFileSync(join(directory, 'server', 'index.ts'), 'build one');
    const env = {
      PORT: '3001',
      OPENAI_API_KEY: 'fixture-secret-never-published',
      DATABASE_PATH: join(directory, 'one.sqlite'),
    };
    const first = runtimeIdentity(directory, env);
    assert.deepEqual(runtimeIdentity(directory, env), first);
    const health = {
      ok: true,
      service: 'workroom',
      mode: 'workspace',
      workspaceId: 'same',
      ...first,
    };
    assert.equal(runtimeMatches(health, { workspaceId: 'same', ...first }), true);
    assert.equal(
      runtimeMatches({ ...health, service: 'foreign' }, { workspaceId: 'same', ...first }),
      false,
    );
    const changedConfig = runtimeIdentity(directory, {
      ...env,
      OPENAI_API_KEY: 'different-secret',
    });
    assert.notEqual(changedConfig.configId, first.configId);
    assert.equal(runtimeMatches(health, { workspaceId: 'same', ...changedConfig }), false);
    const changedDb = runtimeIdentity(directory, {
      ...env,
      DATABASE_PATH: join(directory, 'two.sqlite'),
    });
    assert.notEqual(changedDb.databaseId, first.databaseId);
    writeFileSync(join(directory, 'server', 'index.ts'), 'build two');
    const changedBuild = runtimeIdentity(directory, env);
    assert.notEqual(changedBuild.buildId, first.buildId);
    assert.equal(runtimeMatches(health, { workspaceId: 'same', ...changedBuild }), false);
    assert.ok(!JSON.stringify(first).includes(env.OPENAI_API_KEY));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the launcher reuses a matching server and rejects changed code, configuration, database and foreign ports before setup', async () => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const { copyFileSync } = await import('node:fs');
  const { sourceHash } = await import('../scripts/runtime-identity.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'workroom-launcher-'));
  let health;
  const server = createServer((_req, res) =>
    res.end(typeof health === 'string' ? health : JSON.stringify(health)),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const folder of ['scripts', 'server', 'node_modules/tsx', 'dist'])
      mkdirSync(join(directory, folder), { recursive: true });
    for (const file of ['launch.mjs', 'local-model.mjs', 'runtime-identity.mjs'])
      copyFileSync(
        new URL(`../scripts/${file}`, import.meta.url),
        join(directory, 'scripts', file),
      );
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, 'package-lock.json'), '{}');
    writeFileSync(join(directory, '.env'), 'WORKROOM_LOCAL_SETUP=0\n');
    writeFileSync(join(directory, 'server/index.ts'), '// old build');
    writeFileSync(join(directory, 'node_modules/tsx/package.json'), '{}');
    writeFileSync(
      join(directory, 'node_modules/.workroom-install'),
      createHash('sha256').update('{}').digest('hex'),
    );
    writeFileSync(join(directory, 'dist/index.html'), 'A prepared fixture');
    writeFileSync(join(directory, 'dist/.workroom-build'), sourceHash(directory));
    const env = {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: join(directory, 'one.sqlite'),
      AGENT_PROVIDER: 'external',
      WORKROOM_LOCAL_SETUP: '0',
      WORKROOM_NO_OPEN: '1',
      WORKROOM_DEMO: '0',
      WORKROOM_ORIGIN: '',
      CODESPACES: 'false',
    };
    health = {
      ok: true,
      service: 'workroom',
      mode: 'workspace',
      workspaceId: createHash('sha256').update(directory).digest('hex').slice(0, 16),
      ...runtimeIdentity(directory, env),
    };
    async function launch(overrides = {}) {
      const child = spawn(process.execPath, [join(directory, 'scripts/launch.mjs')], {
        env: { ...env, ...overrides },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (b) => {
        output += b;
      });
      child.stderr.on('data', (b) => {
        output += b;
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      const code = await new Promise((resolve) => child.once('exit', resolve));
      clearTimeout(timer);
      return { code, output };
    }
    const matching = await launch();
    assert.equal(matching.code, 0, matching.output);
    assert.match(matching.output, /already ready/);
    for (const overrides of [
      { OPENAI_MODEL: 'changed-model' },
      { DATABASE_PATH: join(directory, 'two.sqlite') },
    ]) {
      const changed = await launch(overrides);
      assert.equal(changed.code, 1);
      assert.match(changed.output, /older Workroom instance/);
      assert.doesNotMatch(changed.output, /Installing what|Downloading/);
    }
    writeFileSync(join(directory, 'server/index.ts'), '// changed build');
    const changed = await launch();
    assert.equal(changed.code, 1);
    assert.match(changed.output, /older Workroom instance/);
    health = 'A completely different application';
    const foreign = await launch();
    assert.equal(foreign.code, 1);
    assert.match(foreign.output, /another service/);
    const invalid = await launch({ PORT: '0' });
    assert.equal(invalid.code, 1);
    assert.match(invalid.output, /between 1024 and 65535/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
