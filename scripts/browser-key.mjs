import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, lstatSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// This capability lives outside managed project folders and is never passed to workers.
export function browserKey(root) {
  const folder = join(root, '.data');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = join(folder, 'browser-access-key');
  try {
    writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128)
    throw new Error('Browser access key must be a regular private file.');
  const key = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error(
      'Invalid browser access key. Restore .data/browser-access-key or move it aside while Workroom is stopped.',
    );
  chmodSync(file, 0o600);
  return key;
}
export const pairedUrl = (url, key) => `${url.replace(/\/$/, '')}/#workroom-key=${key}`;
