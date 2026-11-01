process.env.WORKROOM_DEMO = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CodexLogin,
  devicePrompt,
  browserPrompt,
  codexLoginCommand,
} from '../server/codex-login.js';
import type { CodexAuthProof } from '../shared/codex-connection.js';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';

function fixture(initial = false, extra: Record<string, unknown> = {}) {
  const store = new Store(':memory:'),
    engine = new Engine(store);
  let authenticated = initial,
    stamp = 'first';
  const children: any[] = [],
    modes: string[] = [],
    releases: string[] = [];
  const manager = new CodexLogin({
    check: async (): Promise<CodexAuthProof> => ({
      command: 'npx --no-install codex login status',
      code: authenticated ? 'authenticated' : 'signed_out',
      exitCode: authenticated ? 0 : 1,
      message: authenticated ? 'ChatGPT sign-in verified.' : 'Not signed in.',
      checkedAt: Date.now(),
    }),
    stamp: () => stamp,
    acquire: () => engine.beginConnectionChange('Sign-in pending.'),
    release: (owner) => {
      releases.push(owner);
      engine.endConnectionChange(owner);
    },
    launch: (mode) => {
      modes.push(mode);
      const child: any = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.pid = 123;
      child.kill = () => {
        queueMicrotask(() => child.emit('close', 143));
        return true;
      };
      children.push(child);
      return child as ChildProcess;
    },
    ...extra,
  });
  return {
    manager,
    engine,
    store,
    children,
    modes,
    releases,
    auth: (value: boolean) => {
      authenticated = value;
    },
    stamp: (value: string) => {
      stamp = value;
    },
    close: async () => {
      await manager.shutdown();
      engine.stop();
      store.close();
    },
  };
}

test('a successful terminal login clears a lingering device attempt and releases work without signing out', async () => {
  const f = fixture();
  try {
    await f.manager.start('device');
    f.children[0].stdout.write('https://auth.openai.com/codex/device ABCD-EFGH\nPRIVATE RAW TEXT');
    assert.equal(f.manager.state().login?.status, 'waiting');
    assert.throws(() => f.engine.assertConnectionsIdle(), /setup to finish/);
    f.auth(true);
    const result = await f.manager.check();
    assert.equal(result.proof?.code, 'authenticated');
    assert.equal(result.login?.status, 'completed');
    assert.equal(result.login?.url, undefined);
    assert.equal(result.login?.code, undefined);
    assert.equal(f.engine.bootstrap().connectionChange, undefined);
    assert.equal(JSON.stringify(result).includes('PRIVATE RAW TEXT'), false);
    assert.equal(f.releases.length, 1);
  } finally {
    await f.close();
  }
});

test('reset stops owned processes, clears stale state, preserves current authentication and permits reconnect', async () => {
  const f = fixture(true);
  try {
    const first = await f.manager.start();
    const reset = await f.manager.reset();
    assert.equal(reset.login, null);
    assert.equal(reset.proof?.code, 'authenticated');
    assert.equal(f.engine.bootstrap().connectionChange, undefined);
    const second = await f.manager.start('browser', true);
    assert.notEqual(second.login?.id, first.login?.id);
    const newerOwner = f.releases[0];
    f.engine.endConnectionChange(newerOwner);
    assert.match(f.engine.bootstrap().connectionChange!, /pending/);
    await assert.rejects(() => f.manager.reset(first.login!.id), /replaced/);
    assert.deepEqual(f.modes, ['browser', 'browser']);
  } finally {
    await f.close();
  }
});

test('a previous account does not auto-complete an intentional reconnect; Check status can explicitly accept it', async () => {
  const f = fixture(true);
  try {
    await f.manager.start('browser');
    assert.equal((await f.manager.check()).login?.status, 'starting');
    assert.ok(f.engine.bootstrap().connectionChange);
    const checked = await f.manager.check(true);
    assert.equal(checked.login, null);
    assert.equal(checked.proof?.code, 'authenticated');
    assert.equal(f.engine.bootstrap().connectionChange, undefined);
  } finally {
    await f.close();
  }
});

test('credential replacement from a terminal is recognized even when an earlier account was already signed in', async () => {
  const f = fixture(true);
  try {
    await f.manager.start();
    f.stamp('terminal-login');
    assert.equal((await f.manager.check()).login?.status, 'completed');
    assert.equal(f.releases.length, 1);
  } finally {
    await f.close();
  }
});

test('unsupported device authentication fails promptly without leaving the team locked', async () => {
  const f = fixture();
  try {
    await f.manager.start('device');
    f.children[0].stderr.write('Enable device code sign-in for Codex');
    const result = await f.manager.check();
    assert.equal(result.login?.status, 'failed');
    assert.match(result.login!.message, /browser/);
    assert.equal(f.engine.bootstrap().connectionChange, undefined);
    await f.manager.start('browser');
    assert.equal(f.children.length, 2);
  } finally {
    await f.close();
  }
});

test('browser sign-in uses the bundled login command; only trusted authorization links are displayed', () => {
  assert.equal(codexLoginCommand('browser').args.includes('--device-auth'), false);
  assert.equal(codexLoginCommand('device').args.includes('--device-auth'), true);
  const url =
    'https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=ephemeral';
  assert.equal(browserPrompt(`Open ${url}`), url);
  assert.equal(browserPrompt(url.replace('auth.openai.com', 'evil.example')), undefined);
  assert.equal(browserPrompt(url.replace('localhost', 'evil.example')), undefined);
  assert.equal(devicePrompt('https://evil.example/codex/device ABCD-EFGH'), undefined);
});

test('timeouts and launch errors release only their own connection hold', async () => {
  const f = fixture(false, { timeoutMs: 5 });
  try {
    await f.manager.start();
    await delay(25);
    assert.equal((await f.manager.check()).login?.status, 'failed');
    assert.equal(f.engine.bootstrap().connectionChange, undefined);
    const owner = f.engine.beginConnectionChange('Saving settings.');
    f.engine.endConnectionChange(f.releases[0]);
    assert.equal(f.engine.bootstrap().connectionChange, 'Saving settings.');
    f.engine.endConnectionChange(owner);
  } finally {
    await f.close();
  }
  const broken = fixture(false, {
    launch: () => {
      throw new Error('PRIVATE ERROR');
    },
  });
  try {
    assert.equal((await broken.manager.start()).login?.status, 'failed');
    assert.equal(broken.engine.bootstrap().connectionChange, undefined);
    assert.equal(JSON.stringify(broken.manager.state()).includes('PRIVATE ERROR'), false);
  } finally {
    await broken.close();
  }
});

test('late close events from a replaced attempt cannot clear a newer sign-in', async () => {
  const f = fixture();
  try {
    await f.manager.start();
    const first = f.children[0];
    await f.manager.start('browser', true);
    first.emit('close', 0);
    await delay(5);
    assert.equal(f.manager.state().login?.status, 'starting');
    assert.ok(f.engine.bootstrap().connectionChange);
    assert.equal(f.releases.length, 1);
  } finally {
    await f.close();
  }
});
