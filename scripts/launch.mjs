import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sourceHash, runtimeIdentity, runtimeMatches } from './runtime-identity.mjs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createLocalEnv,
  ensureLocalModel,
  startupProvider,
  startupDatabase,
} from './local-model.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const prepareOnly = process.argv.includes('--prepare-only');
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
    try {
      return response.ok ? await response.json() : { occupied: true };
    } catch {
      return { occupied: true };
    }
  } catch (error) {
    return error.cause?.code === 'ECONNREFUSED' ? undefined : { occupied: true };
  }
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error(
      'Install Node.js 24 LTS from https://nodejs.org, reopen your terminal, then run npm run local again.',
    );
  mkdirSync(join(root, '.data'), { recursive: true });
  // New files receive local defaults; existing configuration stays intact.
  createLocalEnv(root);
  process.loadEnvFile('.env');
  const selected = startupProvider(root);
  const database = startupDatabase(root);
  if (!process.env.DATABASE_PATH && database === join(root, '.data', 'demo.sqlite'))
    console.log(
      'Opening existing records from .data/demo.sqlite. This workspace uses real model connections; historical simulation results remain labeled.',
    );
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Set PORT to a port between 1024 and 65535.');
  const localUrl = `http://127.0.0.1:${port}`;
  const forwardedUrl =
    process.env.CODESPACES === 'true' && process.env.CODESPACE_NAME
      ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`
      : '';
  const displayUrl = forwardedUrl || localUrl;
  const childEnv = {
    ...process.env,
    PORT: String(port),
    HOST: process.env.CODESPACES === 'true' ? '0.0.0.0' : '127.0.0.1',
    AGENT_PROVIDER: selected,
    WORKROOM_DEMO: '0',
    DATABASE_PATH: database,
    ...(forwardedUrl ? { WORKROOM_ORIGIN: forwardedUrl } : {}),
  };
  const expected = { workspaceId, ...runtimeIdentity(root, childEnv) };
  const running = prepareOnly ? undefined : await health(localUrl);
  if (running && !runtimeMatches(running, expected))
    throw new Error(
      `Port ${port} is occupied by an older Workroom instance, different settings/database, or another service. Stop the existing Workroom terminal with Ctrl+C and run npm run local again; or choose a different PORT. No running process was stopped.`,
    );
  const lockHash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
  const installStamp = join(root, 'node_modules', '.workroom-install');
  if (!existsSync('node_modules/tsx/package.json') || !matches(installStamp, lockHash)) {
    console.log('\n1/3 · Installing what Workroom needs. This is automatic on the first run.\n');
    await runNpm(['ci', '--no-audit', '--no-fund']);
    writeFileSync(installStamp, lockHash);
  } else console.log('\n1/3 · Dependencies are ready.');
  const buildHash = sourceHash(root);
  const buildStamp = join(root, 'dist', '.workroom-build');
  if (!existsSync('dist/index.html') || !matches(buildStamp, buildHash)) {
    console.log('\n2/3 · Preparing the browser app.\n');
    await runNpm(['run', 'build']);
    writeFileSync(buildStamp, buildHash);
  } else console.log('2/3 · Browser app is ready.');
  if (prepareOnly) {
    console.log(
      '\nWorkroom is prepared. Run npm run local for your saved workspace and local model setup.\n',
    );
    process.exit(0);
  }
  if (runtimeMatches(running, expected)) {
    console.log(
      `\nWorkroom is already ready: ${displayUrl}\nCreate a project or open your saved work.\n`,
    );
    openBrowser(displayUrl);
  } else {
    // Preserve an existing Codex/API/external choice. Only local-first workspaces
    // trigger installation, and setup can explicitly be managed separately.
    if (selected === 'ollama' && process.env.WORKROOM_LOCAL_SETUP !== '0') {
      try {
        await ensureLocalModel(root);
      } catch (error) {
        throw new Error(
          `Local model setup could not finish: ${error.message}\nRun npm run setup:local to retry. See docs/LOCAL-MODELS.md for installation and exact-tag troubleshooting. Your saved work is retained; no model or API fallback was used.`,
        );
      }
    }
    console.log('\n3/3 · Opening your saved workspace…\n');
    server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: root,
      stdio: 'inherit',
      env: childEnv,
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
      if (runtimeMatches(await health(localUrl), expected)) {
        ready = true;
        break;
      }
      await delay(150);
    }
    if (!ready)
      throw new Error(
        `Workroom could not start on port ${port}. Check the server message above. If another app uses that port, set PORT to a free port and try again.`,
      );
    console.log(
      `\nWORKROOM IS READY\n${displayUrl}\n\nCreate a project → review its model-generated plan → Run team.\nConnection: ${selected}. No simulated work or automatic paid fallback.\nKeep this terminal open; press Ctrl+C to stop. Ollama may keep running in the background.\n`,
    );
    openBrowser(displayUrl);
  }
} catch (error) {
  server?.kill('SIGTERM');
  console.error(`\n${error.message}\n`);
  process.exitCode = 1;
}
