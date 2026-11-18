process.env.WORKROOM_DEMO = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { specialistMemory } from '../server/specialist-memory.js';
import { assembleContext } from '../server/context.js';
import { result } from './work-fixtures.js';

test('backup and restore preserve generated specialist-memory labels and task output', () => {
  const store = new Store(':memory:'),
    restored = new Store(':memory:');
  try {
    const previous = store.state.tasks[0];
    previous.title = 'Experiment ' + '測'.repeat(85);
    previous.status = 'done';
    previous.output = 'Saved proposal; outcomes unknown.';
    previous.result = result();
    const project = store.state.projects.find((p) => p.id === previous.projectId)!;
    const agent = store.state.agents.find((a) => a.id === previous.agentId)!;
    const next = {
      ...structuredClone(previous),
      id: randomUUID(),
      title: 'Review the supplied proposal',
      dependencies: [],
      status: 'queued' as const,
      output: '',
      result: undefined,
    };
    next.contextReport = assembleContext(
      'Review actual evidence.',
      { specialistMemory: specialistMemory(project, agent, next, store.state.tasks) },
      24000,
    ).report;
    store.state.tasks.push(next);
    const label = next.contextReport.sources[0].label;
    const fullLabel = specialistMemory(project, agent, next, store.state.tasks)[0].title;
    assert.ok(fullLabel.length > 100);
    assert.equal(label, fullLabel.slice(0, 100));
    const backup = store.backup();
    assert.equal(
      backup.state.tasks.find((t) => t.id === next.id)!.contextReport!.sources[0].label,
      label,
    );
    restored.restore(JSON.parse(JSON.stringify(backup)));
    assert.equal(
      restored.state.tasks.find((t) => t.id === next.id)!.contextReport!.sources[0].label,
      label,
    );
    assert.equal(restored.state.tasks.find((t) => t.id === previous.id)!.output, previous.output);
    assert.equal(
      store.state.tasks.find((t) => t.id === next.id)!.contextReport!.sources[0].label,
      label,
    );
  } finally {
    store.close();
    restored.close();
  }
});
