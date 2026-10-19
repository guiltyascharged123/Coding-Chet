import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import {
  wordDocument,
  workbookDocument,
  workbookSheets,
  parseDocument,
} from '../src/documents/export.js';
import { initialState, agents, demoPlan } from '../server/seed.js';
import { runTask } from '../server/providers.js';

test('the office pack creates six distinct, honestly labeled documents and preserves review', async () => {
  const project = { ...initialState().projects[0], documentPack: 'office' as const };
  const tasks = demoPlan(project, agents);
  assert.equal(new Set(tasks.map((t) => t.documentKind)).size, 6);
  assert.equal(tasks[1].requiresApproval, true);
  for (const task of tasks) {
    const output = await runTask(
      'demo',
      project,
      task,
      agents.find((a) => a.id === task.agentId)!,
      [],
      new AbortController().signal,
    );
    assert.match(output, /Demo template — no AI model call/);
    assert.ok(parseDocument(output).some((block) => block.kind === 'table'));
    if (task.documentKind === 'budget')
      assert.match(output, /illustrative planning assumptions, not quotes/);
    if (task.documentKind === 'meeting_minutes') assert.match(output, /No meeting has taken place/);
  }
});

test('Word and Excel exports contain editable tables, numeric budgets, and safe text cells', async () => {
  const content =
    '# Office budget\n\n> Illustrative estimate; not approved.\n\n## Budget estimate\n\n| Item | Quantity | Unit cost | Estimated total |\n| --- | --- | --- | --- |\n| Research | 8 | $75.00 | $600.00 |\n| Review | 6 | $75.00 | $450.00 |\n\n## Action log\n\n| ID | Action |\n| --- | --- |\n| 001 | =HYPERLINK("https://example.com") |\n\n## Action log\n\n| Owner | Note |\n| --- | --- |\n| Chet | Keep costs \\| assumptions visible |';
  const doc = unzipSync(
    new Uint8Array(await (await wordDocument('Office budget', content)).arrayBuffer()),
  );
  assert.ok(doc['word/document.xml']);
  const word = strFromU8(doc['word/document.xml']);
  assert.match(word, /<w:tbl>/);
  assert.match(word, /Illustrative estimate/);
  assert.match(word, /Keep costs \| assumptions visible/);
  const workbook = unzipSync(
    new Uint8Array(await (await workbookDocument('Office budget', content)).arrayBuffer()),
  );
  const sheets = strFromU8(workbook['xl/workbook.xml']);
  assert.match(sheets, /Budget estimate/);
  assert.match(sheets, /Action log 2/);
  const budget = strFromU8(workbook['xl/worksheets/sheet2.xml']);
  assert.match(budget, /<f>B2\*C2<\/f>/);
  assert.match(budget, /<f>SUM\(D2:D3\)<\/f>/);
  assert.match(budget, /<v>75<\/v>/);
  const actions = strFromU8(workbook['xl/worksheets/sheet3.xml']);
  assert.ok(!actions.includes('<f>')); // Model text must not become an executable formula.
  assert.match(strFromU8(workbook['xl/sharedStrings.xml']), /001/);
  const names = workbookSheets('Names', '## Read me\n\n| A | B |\n| --- | --- |\n| 1 | 2 |').map(
    (s) => s.sheet!.toLowerCase(),
  );
  assert.equal(new Set(names).size, names.length);
});
