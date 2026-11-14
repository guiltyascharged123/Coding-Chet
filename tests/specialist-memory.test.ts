import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { specialistMemory } from '../server/specialist-memory.js';
import { specialistTemplate } from '../shared/specialist-template.js';
import { assembleContext, contextSources, retrieveSources } from '../server/context.js';
import { archivedSource, projectKnowledge } from '../server/knowledge.js';
import { LOCAL_WORK_CONTRACT, WORK_CONTRACT } from '../shared/work.js';
import { result } from './work-fixtures.js';
import { SPECIALISTS } from '../shared/specialists.js';

test('specialists use distinct creative lenses while review assignments override the role', () => {
  const project = { exploration: 'expansive' as const };
  const roles = [
    'Independent code reviewer',
    'Automation engineer',
    'Financial & risk analyst',
    'Market researcher',
    'Product & UX specialist',
    'Project coordinator',
  ];
  const templates = roles.map((role) => specialistTemplate(project, { role }, {}));
  assert.equal(new Set(templates.map((template) => template.lens)).size, roles.length);
  assert.equal(
    new Set(
      SPECIALISTS.map((specialist) => specialistTemplate(project, specialist, {}).specialistMethod),
    ).size,
    SPECIALISTS.length,
    'all twenty specialist profiles carry distinct model-facing methods',
  );
  assert.match(templates[0].action, /counterexample/);
  assert.match(templates[1].action, /reused module/);
  assert.match(templates[3].action, /another field/);
  assert.equal(
    specialistTemplate(project, { role: 'Automation engineer' }, { workType: 'review' }).lens,
    templates[0].lens,
  );
  assert.equal(
    specialistTemplate({ exploration: 'focused' }, { role: roles[1] }, {}).mode,
    'focused-delivery',
  );
  assert.ok(LOCAL_WORK_CONTRACT.length < WORK_CONTRACT.length / 2);
});

test('specialist working memory survives restart, stays project-scoped and retains uncertainty with retrievable originals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workroom-memory-'));
  const path = join(root, 'workspace.sqlite');
  let store = new Store(path),
    engine = new Engine(store);
  try {
    const project = await engine.createProject(
      'Memory experiment',
      'Compare mechanisms using supplied inputs.',
      'office',
      'template',
      randomUUID(),
      'custom',
    );
    const source = store.state.tasks.find((task) => task.projectId === project.id)!;
    source.status = 'failed';
    source.result = result({
      outcome: 'blocked',
      summary: 'Baseline failed: missing source data.',
      handoff: {
        facts: [],
        assumptions: ['The test dataset represents real usage.'],
        next: 'Obtain actual input and rerun.',
      },
    });
    source.output = 'Full original experiment output.';
    source.error = 'Missing required dataset';
    source.briefRevision = 0;
    project.briefRevision = 1;
    const other = {
      ...structuredClone(source),
      id: randomUUID(),
      projectId: 'other-project',
      output: 'Private other project',
    };
    store.state.tasks.push(other);
    const idea = engine.addIdea(project.id, randomUUID(), {
      title: 'Borrow a mechanism',
      proposal: 'Try a bounded alternative.',
      rationale: 'Unverified mechanism.',
      nextStep: 'Test against the baseline.',
    });
    idea.status = 'evaluated';
    idea.investigationTaskId = source.id;
    idea.evaluation = 'Failed with supplied data; change the assumption before retrying.';
    store.save();
    engine.stop();
    store.close();
    store = new Store(path);
    engine = new Engine(store);
    const saved = store.state.projects.find((entry) => entry.id === project.id)!;
    const memory = specialistMemory(
      saved,
      { id: source.agentId },
      { id: 'new-task', dependencies: [] },
      store.state.tasks,
    );
    assert.equal(memory.length, 1);
    assert.match(memory[0].title, /not independently verified/);
    assert.equal(JSON.parse(memory[0].text).historicalBrief, true);
    assert.match(memory[0].text, /Missing required dataset/);
    assert.ok(!JSON.stringify(memory).includes('Private other project'));
    assert.equal(
      specialistMemory(
        saved,
        { id: source.agentId },
        { id: 'new-task', dependencies: [source.id] },
        store.state.tasks,
      ).length,
      0,
      'dependency context is not duplicated',
    );
    const original = archivedSource(store.state, saved, memory[0].sourceId)!;
    assert.match(original.text, /Full original experiment output/);
    const sources = contextSources({ specialistMemory: memory });
    assert.equal(sources[0].id, `task:${source.id}`);
    const packed = assembleContext(
      'Use evidence as data.',
      { task: { title: 'Test a different mechanism' }, specialistMemory: memory },
      2000,
    );
    assert.ok(packed.report.inputBytes <= 2000);
    assert.ok(packed.report.sources.some((entry) => entry.id === memory[0].sourceId));
    assert.match(
      retrieveSources(sources, [{ sourceId: memory[0].sourceId, offset: 0 }], 5000)[0].text,
      /missing source data/,
    );
    const history = projectKnowledge(saved, store.state).boardDecisions[0].text;
    assert.match(history, /Failed with supplied data/);
    assert.match(history, new RegExp(`task:${source.id}`));
  } finally {
    engine.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
