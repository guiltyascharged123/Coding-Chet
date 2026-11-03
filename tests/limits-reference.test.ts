import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { limitsCatalog } from '../server/limits-catalog.js';
import { POLICY_FIELDS, RESOURCE_LIMITS } from '../shared/limits.js';
import { defaultPolicy, policySchema, backupSchema } from '../shared/schemas.js';
import { WORK_RESULT_JSON_SCHEMA } from '../shared/work.js';
import { validationMessages } from '../shared/validation.js';
import { localContextTokens } from '../server/managed.js';

test('the visible reference reflects actual validators and adjustable policy ranges, without credentials', () => {
  const store = new Store(':memory:');
  try {
    const reference = limitsCatalog(store),
      schema = z.toJSONSchema(policySchema) as any;
    for (const [key, , min, max] of POLICY_FIELDS) {
      assert.equal(schema.properties[key].minimum, min, key);
      assert.equal(schema.properties[key].maximum, max, key);
      assert.equal(
        reference.editable.find((value) => value.key === key)!.value,
        defaultPolicy[key as keyof typeof defaultPolicy],
      );
    }
    assert.ok(
      reference.formats.some(
        (value) =>
          value.group === 'Task plan' &&
          value.field === 'tasks[].title' &&
          value.rule === '1–100 characters',
      ),
    );
    assert.ok(
      reference.formats.some(
        (value) =>
          value.group === 'Task plan' &&
          value.field === 'tasks[].description' &&
          value.rule === '1–4000 characters',
      ),
    );
    assert.ok(
      reference.fixed.some(
        (value) =>
          value.name === 'Browser source listing' &&
          value.value.includes(String(RESOURCE_LIMITS.projectFiles)),
      ),
    );
    assert.equal(WORK_RESULT_JSON_SCHEMA.properties.summary.maxLength, 1200);
    assert.equal(WORK_RESULT_JSON_SCHEMA.properties.deliverable.maxLength, 100000);
    assert.equal(WORK_RESULT_JSON_SCHEMA.properties.followUps.maxItems, 3);
    assert.equal(
      WORK_RESULT_JSON_SCHEMA.properties.followUps.items.properties.description.maxLength,
      2000,
    );
    assert.ok(!JSON.stringify(WORK_RESULT_JSON_SCHEMA).includes('"default":'));
  } finally {
    store.close();
  }
});

test('saved brief and instruction history continues beyond the old 100/50 stops and survives backup', async () => {
  const store = new Store(':memory:'),
    engine = new Engine(store);
  try {
    const project = await engine.createProject(
      'Retained versions',
      'Keep useful brief and instruction versions without an arbitrary history stop.',
      'office',
      'manual',
      randomUUID(),
      'office',
    );
    project.briefHistory = Array.from({ length: 100 }, (_, index) => ({
      title: project.title,
      brief: project.brief,
      changedAt: index + 1,
      reason: 'Earlier edit',
    }));
    project.instructionHistory = Array.from({ length: 50 }, (_, index) => ({
      id: randomUUID(),
      text: `Earlier instruction ${index}`,
      reason: 'Earlier edit',
      createdAt: index + 1,
    }));
    engine.updateProject(project.id, {
      title: project.title,
      brief: project.brief + ' Preserve all earlier versions.',
      expectedUpdatedAt: project.createdAt,
    });
    engine.updateInstructions(
      project.id,
      'Keep current work grounded in supplied evidence.',
      'Version after old limit.',
    );
    assert.equal(project.briefHistory.length, 101);
    assert.equal(project.instructionHistory.length, 51);
    const backup = store.backup();
    assert.ok(backupSchema.safeParse(backup).success);
    store.restore(backup);
    assert.equal(store.state.projects[0].briefHistory!.length, 101);
    assert.equal(store.state.projects[0].instructionHistory!.length, 51);
  } finally {
    engine.stop();
    store.close();
  }
});

test('validation errors report field paths and measured size without echoing credential contents', () => {
  const input = { apiKey: 'sensitive-value-that-must-not-be-echoed' };
  const parsed = z.object({ apiKey: z.string().max(5) }).safeParse(input);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const text = validationMessages(parsed.error, input).join(' ');
    assert.match(text, /apiKey/);
    assert.match(text, new RegExp(`${input.apiKey.length} characters`));
    assert.ok(!text.includes(input.apiKey));
  }
});

test('local context honors its explicit ceiling and distinguishes output budget from memory capacity', () => {
  const system = 'x'.repeat(180000);
  assert.equal(localContextTokens(system, '', 2000, 8192), 8192);
  assert.ok(localContextTokens(system, '', 2000, 65536) > 32768);
  const store = new Store(':memory:');
  try {
    store.state.policy = {
      ...structuredClone(defaultPolicy),
      maxInputBytes: 200000,
      localContextTokens: 8192,
      maxOutputTokens: 2000,
    };
    const reference = limitsCatalog(store);
    assert.ok(
      reference.project
        .find((value) => value.name === 'Effective Ollama input budget')!
        .value.startsWith(String((8192 - 2000 - 1024) * 3)),
    );
  } finally {
    store.close();
  }
});

test('overdeep exports and oversized previews fail explicitly while leaving local files intact', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'),
    { join } = await import('node:path');
  const { workspaceFiles, workspaceFile } = await import('../server/workspaces.js');
  const root = mkdtempSync(join(tmpdir(), 'workroom-limits-'));
  try {
    const deep = join(root, ...Array.from({ length: 17 }, (_, index) => `folder-${index}`));
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'retained.txt'), 'Original source remains here.');
    assert.throws(() => workspaceFiles(root), /15 levels.*No incomplete ZIP/);
    assert.equal(readFileSync(join(deep, 'retained.txt'), 'utf8'), 'Original source remains here.');
    writeFileSync(join(root, 'large.txt'), 'x'.repeat(RESOURCE_LIMITS.filePreviewBytes + 1));
    assert.throws(
      () => workspaceFile(root, 'large.txt'),
      /256001 bytes.*256000 bytes.*local project folder/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
