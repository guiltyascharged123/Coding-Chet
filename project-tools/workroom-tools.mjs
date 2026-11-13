import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  lstatSync,
} from 'node:fs';
import { join, resolve, relative, dirname, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { projectPath } from './workroom-download.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = (path) => (existsSync(path) ? readFileSync(path) : null);
const signature = (path) => {
  const value = bytes(path);
  return value === null ? null : hash(value);
};
function json(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx' });
}
function replace(root, path, value) {
  const temp = projectPath(root, `${path}.${randomUUID()}.tmp`);
  writeFileSync(temp, value, { flag: 'wx' });
  try {
    renameSync(temp, projectPath(root, path));
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
function stateFolder(root) {
  const path = projectPath(root, '.workroom-tools');
  mkdirSync(path, { recursive: true });
  return path;
}
function withLock(root, run) {
  const lock = projectPath(root, join(stateFolder(root), 'change.lock'));
  writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    return run();
  } finally {
    unlinkSync(lock);
  }
}
function checkTimeout(value) {
  if (!Number.isInteger(value) || value < 5000 || value > 3600000)
    throw new Error('checkTimeoutMs must be 5000–3600000 (default 600000).');
}
function execute(root, command, args, timeout, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === 'win32' && command === 'npm',
    windowsHide: true,
  });
  const receipt = {
    label,
    command,
    args,
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    at: new Date().toISOString(),
  };
  // Public tool output is streamed by the enclosing Codex command receipt.
  console.log(JSON.stringify(receipt));
  return receipt;
}
const passed = (check) => check.exitCode === 0 && !check.error && !check.signal;
function catalogAt(root) {
  const path = projectPath(root, 'tools/workroom-tools.json'),
    raw = readFileSync(path);
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.tools))
    throw new Error('Invalid tool catalog; preserve and repair it before promotion.');
  return { path, raw, data };
}
function revisionFolder(root) {
  const path = projectPath(root, join(stateFolder(root), randomUUID()));
  mkdirSync(path);
  return path;
}

/** Tests run in the caller's existing project sandbox, not a new security boundary. */
export function promoteTool({
  root = process.cwd(),
  candidate,
  target,
  check,
  id,
  purpose,
  checkTimeoutMs = 600000,
} = {}) {
  root = realpathSync(root);
  checkTimeout(checkTimeoutMs);
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(id || '') || typeof purpose !== 'string' || !purpose.trim())
    throw new Error(
      'Provide a tool id (1–80 lower-case letters/digits/hyphens) and a useful purpose.',
    );
  if (
    !/^tools\/[a-zA-Z0-9_/-]+\.(mjs|cjs|js)$/.test(target || '') ||
    target.includes('..') ||
    ['tools/workroom-tools.mjs', 'tools/workroom-tools.json'].includes(target)
  )
    throw new Error(
      'Target must be a project tools/ JavaScript file; the running lifecycle manager cannot replace itself. Propose manager/core changes separately.',
    );
  const source = projectPath(root, candidate),
    destination = projectPath(root, target),
    checker = projectPath(root, check);
  if (!/\.(mjs|cjs|js)$/.test(source) || !/\.(mjs|cjs|js)$/.test(checker) || source === destination)
    throw new Error(
      'Use a separate JavaScript candidate and a JavaScript behavior check, both inside the project.',
    );
  return withLock(root, () => {
    const catalog = catalogAt(root),
      prior = catalog.data.tools.find((tool) => tool.id === id);
    if (prior?.target && prior.target !== target)
      throw new Error('This tool id already owns a different target.');
    if (catalog.data.tools.some((tool) => tool.id !== id && tool.target === target))
      throw new Error('Another tool id owns this target.');
    const revision = revisionFolder(root),
      original = bytes(destination),
      expected = signature(destination),
      sourceBytes = readFileSync(source),
      checkBytes = readFileSync(checker);
    writeFileSync(join(revision, 'candidate.js'), sourceBytes, { flag: 'wx' });
    writeFileSync(join(revision, 'behavior-check.js'), checkBytes, { flag: 'wx' });
    if (original !== null) writeFileSync(join(revision, 'previous.js'), original, { flag: 'wx' });
    const record = {
      version: 1,
      id,
      target,
      purpose,
      previous: prior || null,
      previousHash: expected,
      installedHash: hash(sourceBytes),
      status: 'checking',
      checks: [],
    };
    // Exercise the installed module format and relative imports, without
    // replacing the active tool while its candidate is still being checked.
    mkdirSync(projectPath(root, dirname(destination)), { recursive: true });
    const staged = projectPath(
      root,
      join(dirname(destination), `.workroom-candidate-${randomUUID()}${extname(destination)}`),
    );
    writeFileSync(staged, sourceBytes, { flag: 'wx' });
    const checks = [];
    let unchangedCandidate = false;
    try {
      checks.push(
        execute(
          root,
          process.execPath,
          ['--check', relative(root, staged)],
          checkTimeoutMs,
          'syntax',
        ),
      );
      if (passed(checks[0]))
        checks.push(
          execute(
            root,
            process.execPath,
            [relative(root, checker), relative(root, staged)],
            checkTimeoutMs,
            'behavior',
          ),
        );
      unchangedCandidate = signature(staged) === hash(sourceBytes);
    } finally {
      if (existsSync(staged)) unlinkSync(staged);
    }
    record.checks = checks;
    if (
      !checks.every(passed) ||
      !unchangedCandidate ||
      signature(destination) !== expected ||
      signature(source) !== hash(sourceBytes) ||
      signature(checker) !== hash(checkBytes) ||
      signature(catalog.path) !== hash(catalog.raw)
    ) {
      record.status = 'rejected';
      json(join(revision, 'receipt.json'), record);
      return {
        promoted: false,
        revision: relative(root, revision),
        reason:
          'Checks failed or candidate/target/check/catalog changed during checking. No candidate was promoted. Inspect receipts and any test side effects.',
      };
    }
    const entry = {
      ...prior,
      id,
      target,
      command: `node ${target}`,
      purpose,
      behaviorCheck: `node ${relative(root, checker).split('\\').join('/')} ${target}`,
      revision: relative(root, revision).split('\\').join('/'),
      sha256: hash(sourceBytes),
      checks: checks.map(({ label, exitCode, at }) => ({ label, exitCode, at })),
    };
    catalog.data.tools = catalog.data.tools.filter((tool) => tool.id !== id).concat(entry);
    mkdirSync(projectPath(root, resolve(destination, '..')), { recursive: true });
    try {
      replace(root, destination, sourceBytes);
      replace(root, catalog.path, JSON.stringify(catalog.data, null, 2));
    } catch (error) {
      if (original === null) {
        if (existsSync(destination)) unlinkSync(destination);
      } else replace(root, destination, original);
      throw error;
    }
    record.status = 'promoted';
    json(join(revision, 'receipt.json'), record);
    return { promoted: true, revision: relative(root, revision), tool: entry };
  });
}

export function rollbackTool({ root = process.cwd(), revision } = {}) {
  root = realpathSync(root);
  return withLock(root, () => {
    const folder = projectPath(root, revision);
    if (relative(stateFolder(root), folder).includes('..') || folder === stateFolder(root))
      throw new Error('Select a saved .workroom-tools/<revision> folder.');
    const receiptPath = projectPath(root, join(folder, 'receipt.json')),
      record = JSON.parse(readFileSync(receiptPath));
    if (
      record.version !== 1 ||
      record.status !== 'promoted' ||
      !/^tools\/[a-zA-Z0-9_/-]+\.(mjs|cjs|js)$/.test(record.target || '') ||
      record.target === 'tools/workroom-tools.mjs'
    )
      throw new Error('This is not an active promoted tool revision.');
    const destination = projectPath(root, record.target),
      catalog = catalogAt(root);
    const entry = catalog.data.tools.find((tool) => tool.id === record.id);
    if (
      signature(destination) !== record.installedHash ||
      entry?.revision !== relative(root, folder).split('\\').join('/')
    )
      throw new Error(
        'Tool/catalog has changed since this revision. Preserve later work; rollback will not overwrite it.',
      );
    const prior =
      record.previousHash === null
        ? null
        : readFileSync(projectPath(root, join(folder, 'previous.js')));
    if (prior !== null && hash(prior) !== record.previousHash)
      throw new Error('Previous version checksum does not match; no rollback performed.');
    catalog.data.tools = catalog.data.tools.filter((tool) => tool.id !== record.id);
    if (record.previous) catalog.data.tools.push(record.previous);
    // Update the catalog first, then restore the file; restore catalog on a file failure.
    replace(root, catalog.path, JSON.stringify(catalog.data, null, 2));
    try {
      if (prior === null) unlinkSync(destination);
      else replace(root, destination, prior);
    } catch (error) {
      replace(root, catalog.path, catalog.raw);
      throw error;
    }
    record.status = 'rolled-back';
    replace(root, receiptPath, JSON.stringify(record, null, 2));
    return { rolledBack: true, id: record.id, target: record.target };
  });
}

/** Create a checked patch; never write into the running Workroom checkout. */
export function proposeCoreChange({ root = process.cwd(), repo, checkTimeoutMs = 600000 } = {}) {
  root = realpathSync(root);
  checkTimeout(checkTimeoutMs);
  const folder = projectPath(root, repo),
    gitDirectory = projectPath(root, join(folder, '.git'));
  if (folder === root || !existsSync(gitDirectory) || !lstatSync(gitDirectory).isDirectory())
    throw new Error(
      'Use a separate full Workroom clone inside this project, not the running checkout or a linked worktree.',
    );
  const pkg = JSON.parse(readFileSync(projectPath(root, join(folder, 'package.json'))));
  if (pkg.name !== 'workroom' || !pkg.scripts?.build || !pkg.scripts?.test)
    throw new Error('The checkout must provide Workroom build and test scripts.');
  const git = (args) => {
    const result = spawnSync('git', args, {
      cwd: folder,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0 || result.error)
      throw new Error(`Git check failed: ${result.error?.message || result.stderr}`);
    return result.stdout;
  };
  return withLock(root, () => {
    const revision = revisionFolder(root),
      base = git(['rev-parse', 'HEAD']).trim();
    const untracked = git(['ls-files', '--others', '--exclude-standard']).trim();
    if (untracked)
      throw new Error(
        'Untracked source files remain. Inspect them, stage intended new files, then rerun; no commit/push is needed.',
      );
    const paths = git(['diff', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean);
    if (!paths.length) throw new Error('No Workroom changes to check.');
    if (
      paths.some((name) =>
        /(^|\/)(?:\.env[^/]*|auth\.json|credentials[^/]*|\.data|node_modules|dist)(\/|$)|\.(?:pem|key|p12|pfx)$/i.test(
          name,
        ),
      )
    )
      throw new Error(
        'The proposed patch includes environment, credential, runtime or generated files. Remove them before review.',
      );
    const patch = git(['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD']),
      patchHash = hash(patch);
    const checks = [
      execute(folder, 'npm', ['run', 'build'], checkTimeoutMs, 'build'),
      execute(folder, 'npm', ['test'], checkTimeoutMs, 'unit/integration'),
    ];
    if (
      paths.some((name) =>
        /^(?:src\/|shared\/|server\/|tests\/e2e\/|scripts\/|public\/|index\.html|vite\.config|package(?:-lock)?\.json|playwright\.config)/.test(
          name,
        ),
      )
    ) {
      if (!checks.every(passed))
        checks.push({
          label: 'browser',
          exitCode: null,
          error: 'Not run because build/unit checks failed. Fix them before browser validation.',
        });
      else if (!pkg.scripts['test:e2e'])
        checks.push({
          label: 'browser',
          exitCode: null,
          error: 'UI/runtime changes require a test:e2e script.',
        });
      else checks.push(execute(folder, 'npm', ['run', 'test:e2e'], checkTimeoutMs, 'browser'));
    }
    const unchanged =
      git(['rev-parse', 'HEAD']).trim() === base &&
      hash(git(['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD'])) === patchHash &&
      !git(['ls-files', '--others', '--exclude-standard']).trim();
    const receipt = {
      version: 1,
      kind: 'workroom-core-proposal',
      base,
      paths,
      sha256: patchHash,
      checks,
      readyForReview: unchanged && checks.every(passed),
      applied: false,
      note: 'Checks establish only what they cover. Review the patch and receipts before applying to the real Workroom checkout.',
    };
    writeFileSync(join(revision, 'workroom.patch'), patch, { flag: 'wx' });
    json(join(revision, 'receipt.json'), receipt);
    // Visible outputs for review/export; revision evidence is retained independently.
    const output = projectPath(root, join('tool-proposals', relative(stateFolder(root), revision)));
    mkdirSync(output, { recursive: true });
    writeFileSync(projectPath(root, join(output, 'workroom.patch')), patch, { flag: 'wx' });
    json(projectPath(root, join(output, 'checks.json')), receipt);
    return {
      readyForReview: receipt.readyForReview,
      applied: false,
      output: relative(root, output),
      base,
      paths,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, ...args] = process.argv.slice(2);
  if (!action || action === '--help')
    console.log(
      'Usage:\nnode tools/workroom-tools.mjs promote --candidate candidates/tool.mjs --target tools/tool.mjs --check tests/tool-check.mjs --id tool-name --purpose "Useful function" [--check-timeout-ms 600000]\nThe behavior check receives the candidate path as process.argv[2]. Syntax and behavior must exit 0 before installation/catalog update. Failed checks preserve the existing tool. Checks run in the existing worker sandbox and may have side effects; use focused tests. Receipts retain candidates and prior versions.\nnode tools/workroom-tools.mjs rollback --revision .workroom-tools/<revision-id>\nnode tools/workroom-tools.mjs propose-core --repo workroom-checkout [--check-timeout-ms 600000]\nCore proposals run npm run build and npm test, plus npm run test:e2e for runtime/UI/dependency changes. They produce a patch and check results, never modify the running app. Stage intended new files first. All paths stay inside this project. Checks have 600000ms default timeout (5000–3600000 allowed) and 4MiB output cap per command. Stale .workroom-tools/change.lock requires inspection after a crashed process.',
    );
  else
    try {
      const allowed =
        action === 'promote'
          ? ['candidate', 'target', 'check', 'id', 'purpose', 'check-timeout-ms']
          : action === 'rollback'
            ? ['revision']
            : action === 'propose-core'
              ? ['repo', 'check-timeout-ms']
              : [];
      if (!allowed.length) throw new Error('Unknown action; use --help.');
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        if (!args[i].startsWith('--') || !allowed.includes(key) || !args[i + 1])
          throw new Error('Unknown/incomplete option; use --help.');
        options[key] = args[i + 1];
      }
      if (options['check-timeout-ms']) options.checkTimeoutMs = Number(options['check-timeout-ms']);
      const result =
        action === 'promote'
          ? promoteTool(options)
          : action === 'rollback'
            ? rollbackTool(options)
            : proposeCoreChange(options);
      console.log(JSON.stringify(result, null, 2));
      if (result.promoted === false || result.readyForReview === false) process.exitCode = 2;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
