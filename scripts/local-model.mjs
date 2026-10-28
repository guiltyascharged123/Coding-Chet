import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MODEL = 'huihui_ai/qwen3.5-abliterated:4B';
export const DEFAULT_URL = 'http://127.0.0.1:11434';

export function createLocalEnv(root) {
  const path = join(root, '.env');
  if (existsSync(path)) return false;
  writeFileSync(path, readFileSync(join(root, '.env.example')), { flag: 'wx', mode: 0o600 });
  return true;
}

export function startupDatabase(root, env = process.env) {
  if (env.DATABASE_PATH) return resolve(root, env.DATABASE_PATH);
  const current = join(root, '.data', 'workroom.sqlite');
  const legacy = join(root, '.data', 'demo.sqlite');
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

export function startupProvider(root, env = process.env) {
  if (env.AGENT_PROVIDER) {
    if (
      !['ollama', 'codex', 'openai', 'gemini', 'compatible', 'external'].includes(
        env.AGENT_PROVIDER,
      )
    )
      throw new Error(
        'AGENT_PROVIDER must select a real connection: ollama, codex, openai, gemini, compatible, or external.',
      );
    return env.AGENT_PROVIDER;
  }
  const path = startupDatabase(root, env);
  if (existsSync(path)) {
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const row = db.prepare('SELECT payload FROM workspace WHERE id=1').get();
      const provider = row && JSON.parse(row.payload).provider;
      if (provider && provider !== 'demo') return provider;
    } catch {
      // The normal server reports database problems. Never replace its data.
    } finally {
      db?.close();
    }
  }
  return 'ollama';
}

export function localEndpoint(value = DEFAULT_URL) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('OLLAMA_URL must be a local HTTP/HTTPS address without credentials.');
  return url;
}

export async function installedModels(endpoint, fetcher = fetch) {
  const response = await fetcher(new URL('/api/tags', endpoint), {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const data = await response.json();
  if (!Array.isArray(data.models))
    throw new Error('The service did not return an Ollama model list.');
  return data.models.map((m) => m.name || m.model).filter(Boolean);
}

export function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? accept() : reject(new Error(`${command} exited with status ${code}.`)),
    );
  });
}

async function available(command) {
  try {
    await run(command, ['--version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function findOllama(env = process.env) {
  const candidates = [env.WORKROOM_OLLAMA_BIN, 'ollama'];
  if (process.platform === 'win32' && env.LOCALAPPDATA)
    candidates.push(join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  if (process.platform === 'darwin')
    candidates.push('/Applications/Ollama.app/Contents/Resources/ollama');
  for (const candidate of candidates)
    if (candidate && (await available(candidate))) return candidate;
  return undefined;
}

async function installOllama(root) {
  console.log(
    'Installing Ollama from its official distribution. The installer may request your OS administrator permission.',
  );
  if (process.platform === 'linux') {
    const response = await fetch('https://ollama.com/install.sh', {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Ollama installer download returned HTTP ${response.status}.`);
    const folder = join(root, '.data', 'setup');
    mkdirSync(folder, { recursive: true });
    const script = join(folder, 'ollama-install.sh');
    writeFileSync(script, await response.text(), { mode: 0o600 });
    await run('sh', [script]);
  } else if (process.platform === 'win32') {
    await run('winget', [
      'install',
      '--id',
      'Ollama.Ollama',
      '--exact',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ]);
  } else if (process.platform === 'darwin') {
    await run('brew', ['install', '--cask', 'ollama']);
  } else
    throw new Error(
      'Automatic Ollama installation supports Linux, Windows (winget), and macOS (Homebrew).',
    );
  const binary = await findOllama();
  if (!binary)
    throw new Error(
      'Ollama installed but its command is not available. Reopen the terminal and run npm run setup:local.',
    );
  return binary;
}

async function startOllama(binary, endpoint, root) {
  // Auto-start only the standard local service, not an arbitrary configured host/port.
  if (
    !['localhost', '127.0.0.1'].includes(endpoint.hostname) ||
    !['', '11434'].includes(endpoint.port)
  )
    throw new Error(`Start your configured Ollama service at ${endpoint.origin}, then retry.`);
  mkdirSync(join(root, '.data'), { recursive: true });
  const log = openSync(join(root, '.data', 'ollama.log'), 'a', 0o600);
  const child = spawn(binary, ['serve'], {
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
    env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
  });
  closeSync(log);
  let error;
  child.on('error', (e) => {
    error = e;
  });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await installedModels(endpoint);
      return;
    } catch {
      /* service is starting */
    }
    if (error) throw error;
    if (attempt % 15 === 0) console.log('Waiting for the local Ollama service…');
    await delay(500);
  }
  throw new Error('Ollama did not start. See .data/ollama.log; start Ollama manually and retry.');
}

/** Dependencies are injectable so setup can be verified without downloading GBs
 * of weights, changing the host OS, or making inference requests. */
export async function ensureLocalModel(root, env = process.env, deps = {}) {
  const endpoint = localEndpoint(env.OLLAMA_URL || DEFAULT_URL);
  const model = env.OLLAMA_MODEL || DEFAULT_MODEL;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,149}$/.test(model))
    throw new Error('OLLAMA_MODEL must be an exact model tag without spaces.');
  const list = deps.list || (() => installedModels(endpoint));
  let models;
  try {
    models = await list();
  } catch {
    /* Install/start below. */
  }
  if (models?.includes(model)) {
    console.log(`Local model ready: ${model}. No inference was run.`);
    return;
  }
  let binary = await (deps.find || findOllama)(env);
  if (!binary && !models) binary = await (deps.install || installOllama)(root);
  if (!models) {
    await (deps.start || startOllama)(binary, endpoint, root);
    models = await list();
  }
  if (!models.includes(model)) {
    console.log(
      `Downloading ${model}. First setup needs internet and several GB of free disk space. Later starts reuse it.`,
    );
    if (deps.pull || binary)
      await (
        deps.pull ||
        ((command, tag) =>
          run(command, ['pull', tag], { env: { ...env, OLLAMA_HOST: endpoint.origin } }))
      )(binary, model);
    else {
      const response = await fetch(new URL('/api/pull', endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!response.ok || !response.body)
        throw new Error(`Model download returned HTTP ${response.status}.`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '',
        last = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += value || '';
          const lines = pending.split('\n');
          pending = lines.pop() || '';
          if (done && pending.trim()) {
            lines.push(pending);
            pending = '';
          }
          for (const line of lines) {
            if (!line.trim()) continue;
            const progress = JSON.parse(line);
            if (progress.error) throw new Error(progress.error);
            const message = `${progress.status || 'Downloading'}${progress.total ? ` ${Math.floor(((progress.completed || 0) / progress.total) * 100)}%` : ''}`;
            if (message !== last) {
              console.log(message);
              last = message;
            }
          }
          if (done) break;
        }
      } finally {
        await reader.cancel();
      }
    }
    models = await list();
  }
  if (!models.includes(model))
    throw new Error(
      `Ollama did not list the requested model ${model} after download. Check the exact registry tag; no substitute model was selected.`,
    );
  console.log(`Local model ready: ${model}. No inference was run.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  try {
    createLocalEnv(root);
    process.loadEnvFile(join(root, '.env'));
    await ensureLocalModel(root);
  } catch (error) {
    console.error(
      `Local setup could not finish: ${error.message}\nYour projects and provider settings have been retained. Install Ollama from https://ollama.com/download if needed, then retry npm run setup:local. See docs/LOCAL-MODELS.md. No simulated work or API fallback was used.`,
    );
    process.exitCode = 1;
  }
}
