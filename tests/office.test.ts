import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeSimulation, walkable, DESKS } from '../src/office/simulation.js';
import { agents, initialState } from '../server/seed.js';
import { placeLabels } from '../src/office/labels.js';

test('readable labels stay apart when four characters gather in one place', () => {
  for (const width of [300, 800]) {
    const labels = placeLabels(
      agents.map((a, i) => ({
        id: a.id,
        left: width / 2 - 65 + i * 5,
        top: 260 + i * 2,
        width: 130,
        height: 50,
      })),
      width,
      500,
    );
    for (const a of labels) {
      assert.ok(a.left >= 0 && a.left + a.width <= width && a.top >= 52);
      for (const b of labels)
        if (a.id < b.id)
          assert.ok(
            !(
              a.left < b.left + b.width &&
              a.left + a.width > b.left &&
              a.top < b.top + b.height &&
              a.top + a.height > b.top
            ),
            'labels overlap',
          );
    }
  }
});

test('agents navigate the office continuously without crossing furniture or one another', () => {
  const office = new OfficeSimulation();
  office.update(agents, [], []);
  for (let frame = 0; frame < 7200; frame++) {
    office.step(1 / 60);
    for (const p of office.people.values()) {
      assert.ok(walkable(p), `${p.id} entered furniture at ${p.x}, ${p.z}`);
      for (const q of office.people.values())
        if (p.id < q.id) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= 0.76, 'characters overlap');
    }
  }
  for (const p of office.people.values()) {
    assert.ok(p.distance > 60, `${p.id} got stuck`);
    assert.ok(p.visits > 7);
  }
});

test('a fresh runtime handoff brings both agents to the meeting area, then returns them to work', () => {
  const office = new OfficeSimulation(),
    state = initialState();
  const task = { ...state.tasks[1], status: 'working' as const };
  office.update(
    agents,
    [task],
    [
      {
        id: 'handoff',
        projectId: task.projectId,
        agentId: 'mira',
        targetAgentId: 'sol',
        type: 'message',
        message: 'Handoff',
        createdAt: Date.now(),
      },
    ],
  );
  let met = false;
  for (let frame = 0; frame < 1800; frame++) {
    office.step(1 / 60);
    const a = office.people.get('mira')!,
      b = office.people.get('sol')!;
    if (
      a.goal.action === 'handoff' &&
      b.goal.action === 'handoff' &&
      !a.path.length &&
      !b.path.length
    ) {
      met = true;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1.6);
    }
  }
  assert.ok(met, 'the participants never met');
  assert.equal(office.people.get('sol')!.peer, undefined);
  const oldDistance = office.people.get('sol')!.distance;
  // The same SSE snapshot must not replay an already-seen handoff.
  office.update(
    agents,
    [task],
    [
      {
        id: 'handoff',
        projectId: task.projectId,
        agentId: 'mira',
        targetAgentId: 'sol',
        type: 'message',
        message: 'Handoff',
        createdAt: Date.now(),
      },
    ],
  );
  assert.equal(office.people.get('sol')!.peer, undefined);
  office.step(60);
  assert.ok(
    office.people.get('sol')!.distance - oldDistance < 0.1,
    'a background-tab frame teleported an agent',
  );
});

test('desk swaps reroute the assigned characters without resetting their position', () => {
  const office = new OfficeSimulation();
  office.update(agents, [], []);
  const before = { ...office.people.get('mira')! };
  const swapped = agents.map((a) => ({ ...a, desk: a.desk === 0 ? 1 : a.desk === 1 ? 0 : a.desk }));
  office.update(swapped, [], []);
  const after = office.people.get('mira')!;
  assert.equal(after.x, before.x);
  assert.equal(after.z, before.z);
  assert.equal(after.goal.x, DESKS[1][0]);
  assert.ok(after.path.length > 0);
});
