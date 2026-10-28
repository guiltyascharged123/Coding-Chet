import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_MODEL,
  createLocalEnv,
  startupProvider,
  startupDatabase,
  localEndpoint,
  ensureLocalModel,
} from '../scripts/local-model.mjs';
import { DEFAULT_LOCAL_MODEL } from '../shared/defaults.ts';

test('local setup creates the default environment once and preserves user configuration and saved providers', () => {
  const root = mkdtempSync(join(tmpdir(), 'workroom-local-'));
  try {
    assert.equal(DEFAULT_MODEL, DEFAULT_LOCAL_MODEL);
    const sample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    assert.ok(sample.includes(`OLLAMA_MODEL=${DEFAULT_MODEL}`));
    writeFileSync(join(root, '.env.example'), sample);
    assert.equal(createLocalEnv(root), true);
    assert.equal(startupProvider(root, {}), 'ollama');
    const custom = 'OLLAMA_MODEL=my-own-model:tag\nAGENT_PROVIDER=codex\n';
    writeFileSync(join(root, '.env'), custom);
    assert.equal(createLocalEnv(root), false);
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), custom);
    const path = join(root, 'saved.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE workspace (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
    db.prepare('INSERT INTO workspace VALUES(1, ?)').run(JSON.stringify({ provider: 'codex' }));
    db.close();
    assert.equal(startupProvider(root, { DATABASE_PATH: path }), 'codex');
    mkdirSync(join(root, '.data'));
    copyFileSync(path, join(root, '.data', 'demo.sqlite'));
    assert.equal(startupDatabase(root, {}), join(root, '.data', 'demo.sqlite'));
    assert.equal(
      startupProvider(root, {}),
      'codex',
      'legacy real-provider records remain selected',
    );
    writeFileSync(join(root, '.data', 'workroom.sqlite'), 'a newer workspace exists');
    assert.equal(startupDatabase(root, {}), join(root, '.data', 'workroom.sqlite'));
    assert.equal(
      startupProvider(root, { DATABASE_PATH: path, AGENT_PROVIDER: 'gemini' }),
      'gemini',
    );
    assert.throws(() => startupProvider(root, { AGENT_PROVIDER: 'demo' }), /real connection/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local setup installs, starts, pulls and verifies exactly the requested model without inference', async () => {
  const actions = [];
  let lists = 0;
  await ensureLocalModel(
    '/unused',
    {},
    {
      list: async () => {
        if (++lists === 1) throw new Error('not running');
        return lists === 2 ? [] : [DEFAULT_MODEL];
      },
      find: async () => undefined,
      install: async () => {
        actions.push('install');
        return 'ollama';
      },
      start: async () => {
        actions.push('start');
      },
      pull: async (binary, model) => {
        actions.push(`pull:${binary}:${model}`);
      },
    },
  );
  assert.deepEqual(actions, ['install', 'start', `pull:ollama:${DEFAULT_MODEL}`]);
  assert.equal(lists, 3);
});

test('an installed model is reused, custom tags are honored, and setup failures never choose a replacement', async () => {
  const unexpected = async () => {
    assert.fail('No installer, start or download expected');
  };
  await ensureLocalModel(
    '/unused',
    { OLLAMA_MODEL: 'custom:4b' },
    {
      list: async () => ['custom:4b'],
      find: unexpected,
      install: unexpected,
      start: unexpected,
      pull: unexpected,
    },
  );
  let pulls = 0;
  await assert.rejects(
    () =>
      ensureLocalModel(
        '/unused',
        {},
        {
          list: async () => [],
          find: async () => 'ollama',
          install: unexpected,
          start: unexpected,
          pull: async (_binary, model) => {
            pulls++;
            assert.equal(model, DEFAULT_MODEL);
            throw new Error('model tag not found');
          },
        },
      ),
    /model tag not found/,
  );
  assert.equal(pulls, 1);
  for (const url of [
    'https://outside.example',
    'file:///tmp',
    'http://key@localhost:11434',
    'http://localhost:11434?key=x',
  ])
    assert.throws(() => localEndpoint(url));
  assert.equal(localEndpoint().port, '11434');
});
