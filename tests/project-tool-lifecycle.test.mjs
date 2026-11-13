import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { promoteTool, rollbackTool, proposeCoreChange } from '../project-tools/workroom-tools.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workroom-tools-'));
  for (const name of ['tools', 'candidates', 'checks']) mkdirSync(join(root, name));
  writeFileSync(join(root, 'tools/workroom-tools.json'), JSON.stringify({ version: 1, tools: [] }));
  writeFileSync(
    join(root, 'checks/check.mjs'),
    "import assert from 'node:assert/strict'; import {pathToFileURL} from 'node:url'; import {resolve} from 'node:path'; const {sum} = await import(pathToFileURL(resolve(process.argv[2]))); assert.equal(sum(2,3),5); assert.equal(sum(-1,1),0);",
  );
  const options = {
    root,
    candidate: 'candidates/sum.mjs',
    target: 'tools/sum.mjs',
    check: 'checks/check.mjs',
    id: 'sum',
    purpose: 'Add supplied numbers.',
  };
  return { root, options, close: () => rmSync(root, { recursive: true, force: true }) };
}
test('tools are behavior-checked before promotion, registered for reuse, versioned and rolled back without losing unrelated tools', () => {
  const h = fixture();
  try {
    writeFileSync(join(h.root, h.options.candidate), 'export const sum = (a,b) => a+b;');
    const first = promoteTool(h.options);
    assert.equal(first.promoted, true);
    assert.match(
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "import {sum} from './tools/sum.mjs'; console.log(sum(7,8))"],
        { cwd: h.root, encoding: 'utf8' },
      ),
      /15/,
    );
    const installed = readFileSync(join(h.root, h.options.target), 'utf8');
    writeFileSync(join(h.root, h.options.candidate), 'export const sum = (a,b) => a-b;');
    const bad = promoteTool(h.options);
    assert.equal(bad.promoted, false);
    assert.equal(readFileSync(join(h.root, h.options.target), 'utf8'), installed);
    assert.equal(
      JSON.parse(readFileSync(join(h.root, bad.revision, 'receipt.json'))).status,
      'rejected',
    );
    writeFileSync(join(h.root, h.options.candidate), 'export function sum(a,b) { return a + b; }');
    const update = promoteTool(h.options);
    assert.equal(update.promoted, true);
    const catalogPath = join(h.root, 'tools/workroom-tools.json'),
      catalog = JSON.parse(readFileSync(catalogPath));
    catalog.tools.push({ id: 'unrelated', command: 'node tools/unrelated.mjs' });
    writeFileSync(catalogPath, JSON.stringify(catalog));
    assert.equal(rollbackTool({ root: h.root, revision: update.revision }).rolledBack, true);
    assert.equal(readFileSync(join(h.root, h.options.target), 'utf8'), installed);
    assert.equal(JSON.parse(readFileSync(catalogPath)).tools.length, 2);
    assert.equal(rollbackTool({ root: h.root, revision: first.revision }).rolledBack, true);
    assert.equal(existsSync(join(h.root, h.options.target)), false);
    assert.deepEqual(
      JSON.parse(readFileSync(catalogPath)).tools.map((tool) => tool.id),
      ['unrelated'],
    );
  } finally {
    h.close();
  }
});
test('promotion checks relative imports and module format at the installed location', () => {
  const h = fixture();
  try {
    writeFileSync(join(h.root, 'tools/math.mjs'), 'export const add = (a,b) => a+b;');
    writeFileSync(
      join(h.root, h.options.candidate),
      "import {add} from './math.mjs'; export const sum = add;",
    );
    assert.equal(
      promoteTool(h.options).promoted,
      true,
      'relative imports resolve beside the target, rather than beside candidates/',
    );
    assert.match(
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "import {sum} from './tools/sum.mjs'; console.log(sum(9,1))"],
        { cwd: h.root, encoding: 'utf8' },
      ),
      /10/,
    );
    assert.equal(
      promoteTool({ ...h.options, id: 'incompatible', target: 'tools/incompatible.cjs' }).promoted,
      false,
      'ESM candidate cannot be installed as CommonJS after only checking its source extension',
    );
    assert.equal(existsSync(join(h.root, 'tools/incompatible.cjs')), false);
  } finally {
    h.close();
  }
});
test('lifecycle paths stay in project and rollback refuses to overwrite later manual edits', () => {
  const h = fixture();
  try {
    writeFileSync(join(h.root, h.options.candidate), 'export const sum = (a,b) => a+b;');
    assert.throws(() => promoteTool({ ...h.options, target: '../escape.mjs' }), /Target/);
    assert.throws(
      () => promoteTool({ ...h.options, target: 'tools/workroom-tools.mjs' }),
      /cannot replace itself/,
    );
    const revision = promoteTool(h.options).revision;
    writeFileSync(join(h.root, h.options.target), 'export const later = true;');
    assert.throws(() => rollbackTool({ root: h.root, revision }), /changed since/);
    assert.match(readFileSync(join(h.root, h.options.target), 'utf8'), /later/);
  } finally {
    h.close();
  }
});
test('Workroom patch proposals run real build/unit/browser scripts and mark failed checks unready without applying them', () => {
  const h = fixture();
  try {
    const repo = join(h.root, 'checkout');
    mkdirSync(repo);
    mkdirSync(join(repo, 'src'));
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git(['init', '-q']);
    git(['config', 'user.name', 'Workroom test']);
    git(['config', 'user.email', 'test@example.invalid']);
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'workroom',
        scripts: {
          build: 'node --check src/tool.cjs',
          test: 'node check.cjs',
          'test:e2e': 'node browser-check.cjs',
        },
      }),
    );
    writeFileSync(join(repo, 'src/tool.cjs'), 'module.exports = 1;');
    writeFileSync(
      join(repo, 'check.cjs'),
      "require('node:assert/strict').equal(require('./src/tool.cjs'),2)",
    );
    writeFileSync(join(repo, 'browser-check.cjs'), 'process.exit(0);');
    git(['add', '.']);
    git(['commit', '-qm', 'fixture']);
    writeFileSync(join(repo, 'src/tool.cjs'), 'module.exports = 2;');
    const good = proposeCoreChange({ root: h.root, repo: 'checkout' });
    assert.equal(good.readyForReview, true);
    assert.equal(good.applied, false);
    const receipt = JSON.parse(readFileSync(join(h.root, good.output, 'checks.json')));
    assert.deepEqual(
      receipt.checks.map((check) => check.label),
      ['build', 'unit/integration', 'browser'],
    );
    assert.match(
      readFileSync(join(h.root, good.output, 'workroom.patch'), 'utf8'),
      /module.exports = 2/,
    );
    assert.equal(git(['log', '--oneline']).trim().split('\n').length, 1, 'no commit or push');
    writeFileSync(join(repo, 'src/tool.cjs'), 'module.exports = 3;');
    const bad = proposeCoreChange({ root: h.root, repo: 'checkout' });
    assert.equal(bad.readyForReview, false);
    assert.equal(bad.applied, false);
    assert.equal(readFileSync(join(repo, 'src/tool.cjs'), 'utf8'), 'module.exports = 3;');
  } finally {
    h.close();
  }
});
