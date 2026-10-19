import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const prepareOnly = process.argv.includes('--prepare-only');
const workspace = process.argv.includes('--workspace');
const workspaceId = createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16);
let server;

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  // npm scripts inherit npm's default cache path even when it is unwritable.
  // A CLI flag takes precedence over those inherited settings.
  const cache = process.env.WORKROOM_NPM_CACHE || join(root, '.data', 'npm-cache');
  const commandArgs = ['--cache', cache, ...args];
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm',
      npmCli ? [npmCli, ...commandArgs] : commandArgs,
      {
        cwd: root,
        stdio: 'inherit',
        shell: !npmCli && process.platform === 'win32',
        env: {
          ...process.env,
          npm_config_cache: cache,
          npm_config_update_notifier: 'false',
        },
      },
    );
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0
        ? resolveRun()
        : reject(
            new Error(
              `npm ${args.join(' ')} ${signal ? `stopped (${signal})` : `failed (exit ${code})`}. See the message above.`,
            ),
          ),
    );
  });
}

function sourceHash() {
  const hash = createHash('sha256');
  const add = (name) => {
    const path = join(root, name);
    if (!existsSync(path)) return;
    if (name.endsWith('/')) {
      for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      ))
        add(`${name}${item.name}${item.isDirectory() ? '/' : ''}`);
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
    'tests/',
  ])
    add(name);
  return hash.digest('hex');
}

function matches(path, expected) {
  return existsSync(path) && readFileSync(path, 'utf8').trim() === expected;
}
function openBrowser(url) {
  if (process.env.WORKROOM_NO_OPEN === '1' || process.env.CI || process.env.CODESPACES === 'true')
    return;
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32' || process.env.WSL_DISTRO_NAME
        ? 'rundll32.exe'
        : 'xdg-open';
  const args = command === 'rundll32.exe' ? ['url.dll,FileProtocolHandler', url] : [url];
  const browser = spawn(command, args, { detached: true, stdio: 'ignore' });
  browser.on('error', () => {});
  browser.unref();
}

async function health(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(800) });
    const result = await response.json();
    return (
      result.ok &&
      result.service === 'workroom' &&
      result.mode === (workspace ? 'workspace' : 'demo') &&
      result.workspaceId === workspaceId
    );
  } catch {
    return false;
  }
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error(
      'Install Node.js 24 LTS from https://nodejs.org, reopen your terminal, then run npm run demo again. Or use the browser-only GitHub Codespaces option in the README.',
    );
  mkdirSync(join(root, '.data'), { recursive: true });
  const lockHash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
  const installStamp = join(root, 'node_modules', '.workroom-install');
  if (!existsSync('node_modules/tsx/package.json') || !matches(installStamp, lockHash)) {
    console.log('\n1/3 · Installing what Workroom needs. This is automatic on the first run.\n');
    await runNpm(['ci', '--no-audit', '--no-fund']);
    writeFileSync(installStamp, lockHash);
  } else console.log('\n1/3 · Dependencies are ready.');
  const buildHash = sourceHash();
  const buildStamp = join(root, 'dist', '.workroom-build');
  if (!existsSync('dist/index.html') || !matches(buildStamp, buildHash)) {
    console.log('\n2/3 · Preparing the browser app.\n');
    await runNpm(['run', 'build']);
    writeFileSync(buildStamp, buildHash);
  } else console.log('2/3 · Browser app is ready.');
  if (prepareOnly) {
    console.log(
      '\nWorkroom is prepared. Run npm run local for your saved workspace, or npm run demo for a test drive.\n',
    );
    process.exit(0);
  }
  // Keep this test drive separate from the normal workspace and any paid runtime.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const port = Number(
    workspace ? process.env.PORT || 3001 : process.env.WORKROOM_DEMO_PORT || 3000,
  );
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(
      'Set PORT (workspace) or WORKROOM_DEMO_PORT (demo) to a port between 1024 and 65535.',
    );
  const localUrl = `http://127.0.0.1:${port}`;
  const forwardedUrl =
    process.env.CODESPACES === 'true' && process.env.CODESPACE_NAME
      ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`
      : '';
  const displayUrl = forwardedUrl || localUrl;
  if (await health(localUrl)) {
    console.log(`\nWorkroom is already ready: ${displayUrl}\nClick Run team in the page.\n`);
    openBrowser(displayUrl);
  } else {
    console.log(`\n3/3 · Opening your ${workspace ? 'saved workspace' : 'demo studio'}…\n`);
    server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: String(port),
        HOST: process.env.CODESPACES === 'true' ? '0.0.0.0' : '127.0.0.1',
        ...(!workspace ? { AGENT_PROVIDER: 'demo' } : {}),
        WORKROOM_DEMO: workspace ? '0' : '1',
        DATABASE_PATH: resolve(
          workspace
            ? process.env.DATABASE_PATH || join(root, '.data', 'workroom.sqlite')
            : process.env.WORKROOM_DEMO_DATABASE_PATH || join(root, '.data', 'demo.sqlite'),
        ),
        ...(forwardedUrl ? { WORKROOM_ORIGIN: forwardedUrl } : {}),
      },
    });
    let stopped = false;
    server.on('error', () => {
      stopped = true;
    });
    server.on('exit', (code) => {
      stopped = true;
      process.exitCode = code || process.exitCode || 0;
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server?.kill('SIGTERM'));
    let ready = false;
    for (let attempt = 0; attempt < 100 && !stopped; attempt++) {
      if (await health(localUrl)) {
        ready = true;
        break;
      }
      await delay(150);
    }
    if (!ready)
      throw new Error(
        `Workroom could not start on port ${port}. Check the server message above. If another app uses that port, set ${workspace ? 'PORT' : 'WORKROOM_DEMO_PORT'} to a free port and try again.`,
      );
    console.log(
      `\nWORKROOM IS READY\n${displayUrl}\n\nClick Run team → wait for Review work → approve the draft.\n${workspace ? 'Demo is available without keys. Select a real connection explicitly in Runtime settings.' : 'No API key is needed. Demo mode makes no model calls.'}\nKeep this terminal open; press Ctrl+C to stop.\n`,
    );
    openBrowser(displayUrl);
  }
} catch (error) {
  server?.kill('SIGTERM');
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
}
