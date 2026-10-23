import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfficeSimulation, walkable, DESKS, MEETING_SEATS } from '../src/office/simulation.js';
import { agents, initialState } from '../server/seed.js';
import { placeLabels } from '../src/office/labels.js';
import { DESK_CHAIR, TORSO_BOTTOM, seatedPose } from '../src/office/pose.js';

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

test('idle agents remain at their desks rather than wandering without a work event', () => {
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
    assert.equal(p.distance, 0);
    assert.equal(p.goal.action, 'desk');
  }
});

test('settled desk poses put idle and working bodies on the seat, facing the monitor; routes stay standing', () => {
  const office = new OfficeSimulation();
  office.update(agents, [], []);
  for (const agent of agents) {
    const person = office.people.get(agent.id)!;
    for (const status of [undefined, 'working']) {
      person.status = status;
      const pose = seatedPose(person, agent.desk)!;
      const [deskX, , deskZ] = DESKS[agent.desk];
      assert.equal(person.x + pose.x, deskX);
      assert.equal(person.z + pose.z, deskZ + DESK_CHAIR.z);
      assert.equal(pose.facing, Math.PI);
      assert.ok(Math.abs(pose.y + TORSO_BOTTOM - DESK_CHAIR.seatTop) < 1e-8);
      assert.equal(walkable(person), true, 'navigation remains outside the chair footprint');
    }
    person.path = [{ x: person.x + 1, z: person.z }];
    assert.equal(seatedPose(person, agent.desk), undefined, 'paused travel must not sit in midair');
    person.path = [];
    person.z += 1;
    assert.equal(seatedPose(person, agent.desk), undefined, 'a blocked route is not arrival');
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

test('a real meeting brings all four agents through the room entrance and keeps them there until it ends', () => {
  const office = new OfficeSimulation();
  const meeting = {
    id: 'meeting',
    projectId: 'project',
    agenda: 'Compare approaches and assign useful next actions.',
    trigger: 'manual' as const,
    status: 'running' as const,
    checkpoint: 0,
    participants: agents,
    contributions: [],
    summary: '',
    speakerId: 'mira',
    createdAt: Date.now(),
  };
  office.update(agents, [], [], meeting);
  for (let frame = 0; frame < 3600; frame++) {
    office.step(1 / 60);
    for (const p of office.people.values()) {
      assert.ok(walkable(p), `${p.id} crossed room furniture or glass`);
      for (const q of office.people.values())
        if (p.id < q.id) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) >= 0.76);
    }
  }
  agents.forEach((a, i) => {
    const p = office.people.get(a.id)!;
    assert.equal(p.goal.action, 'meeting');
    assert.ok(
      Math.hypot(p.x - MEETING_SEATS[i].x, p.z - MEETING_SEATS[i].z) < 0.1,
      `${a.id} did not arrive`,
    );
  });
  assert.equal(office.people.get('mira')!.status, 'speaking');
  office.update(agents, [], [], { ...meeting, speakerId: 'sol' });
  assert.equal(office.people.get('sol')!.status, 'speaking');
  assert.equal(office.people.get('mira')!.status, 'listening');
  office.update(agents, [], []);
  for (let frame = 0; frame < 3600; frame++) office.step(1 / 60);
  for (const p of office.people.values()) {
    assert.equal(p.goal.action, 'desk');
    assert.ok(p.path.length === 0);
  }
});
