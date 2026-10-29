import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';

export function sourceHash(root) {
  const hash = createHash('sha256');
  const add = (name) => {
    const path = join(root, name);
    if (!existsSync(path)) return;
    if (name.endsWith('/')) {
      for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (item.isSymbolicLink()) continue;
        add(`${name}${item.name}${item.isDirectory() ? '/' : ''}`);
      }
    } else hash.update(name).update(readFileSync(path));
  };
  for (const name of [
    'package.json',
    'package-lock.json',
    'index.html',
    'tsconfig.json',
    'vite.config.ts',
    'src/',
    'server/',
    'shared/',
    'public/',
    'scripts/',
  ])
    add(name);
  return hash.digest('hex');
}
export function runtimeIdentity(root, env = process.env) {
  root = realpathSync(root);
  const secretFile = join(root, '.data', 'runtime-identity-key');
  mkdirSync(dirname(secretFile), { recursive: true });
  try {
    writeFileSync(secretFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const secret = readFileSync(secretFile);
  const digest = (value) => createHmac('sha256', secret).update(value).digest('hex');
  const settings = Object.fromEntries(
    Object.keys(env)
      .filter((key) =>
        /^(WORKROOM_(CODEX|ORIGIN|DEMO)|OPENAI_|GEMINI_|OLLAMA_|COMPATIBLE_|RUNNER_TOKEN$|AGENT_PROVIDER$|PORT$|HOST$)/.test(
          key,
        ),
      )
      .sort()
      .map((key) => [key, env[key]]),
  );
  return {
    buildId: sourceHash(root),
    configId: digest(JSON.stringify(settings)),
    databaseId: digest(
      env.DATABASE_PATH === ':memory:'
        ? ':memory:'
        : resolve(root, env.DATABASE_PATH || '.data/workroom.sqlite'),
    ),
  };
}
export function runtimeMatches(actual, expected) {
  return (
    !!actual?.ok &&
    actual.service === 'workroom' &&
    actual.mode === 'workspace' &&
    ['workspaceId', 'buildId', 'configId', 'databaseId'].every(
      (key) => actual[key] === expected[key],
    )
  );
}
