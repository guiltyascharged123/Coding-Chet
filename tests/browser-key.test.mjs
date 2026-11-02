import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { browserKey, pairedUrl } from '../scripts/browser-key.mjs';

test('browser pairing persists privately across launches and refuses malformed or linked capabilities', () => {
  const root = mkdtempSync(join(tmpdir(), 'workroom-pairing-'));
  try {
    const key = browserKey(root),
      file = join(root, '.data', 'browser-access-key');
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(browserKey(root), key);
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(
      pairedUrl('http://127.0.0.1:3001', key),
      `http://127.0.0.1:3001/#workroom-key=${key}`,
    );
    writeFileSync(file, 'malformed');
    assert.throws(() => browserKey(root), /Invalid browser access/);
    rmSync(file);
    mkdirSync(file);
    assert.throws(() => browserKey(root), /regular private file/);
    rmSync(file, { recursive: true });
    const target = join(root, 'target');
    writeFileSync(target, key);
    if (process.platform !== 'win32') {
      symlinkSync(target, file);
      assert.throws(() => browserKey(root), /regular private file/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
