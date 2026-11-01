import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agents } from '../server/seed.js';
import { expandTeam } from '../shared/team.js';
import { meetingSeats } from '../shared/office-layout.js';
import { OfficeSimulation, walkable } from '../src/office/simulation.js';
import { SPECIALISTS } from '../shared/specialists.js';
import {
  BASE_AGENT_INSTRUCTIONS,
  SPECIALIST_METHODS,
  roleProcedure,
} from '../shared/role-protocol.js';

test('the specialist catalog contains twenty distinct, actionable roles and expands teams without replacing existing identities', () => {
  assert.equal(SPECIALISTS.length, 20);
  assert.equal(new Set(SPECIALISTS.map((s) => s.role)).size, 20);
  assert.ok(SPECIALISTS.every((s) => s.goal.length > 30 && s.specialty.length > 80));
  assert.equal(new Set(Object.values(SPECIALIST_METHODS)).size, 20);
  for (const profile of SPECIALISTS) {
    const procedure = roleProcedure(profile, { workType: 'plan' });
    assert.ok(procedure.startsWith(BASE_AGENT_INSTRUCTIONS));
    assert.ok(procedure.includes(SPECIALIST_METHODS[profile.role]), profile.role);
  }
  for (const capacity of [4, 8, 12] as const) {
    const team = expandTeam(agents, capacity, 'office');
    assert.equal(team.length, capacity);
    assert.deepEqual(team.slice(0, 4), agents);
    assert.equal(new Set(team.map((a) => a.desk)).size, capacity);
    assert.equal(new Set(team.map((a) => a.id)).size, capacity);
  }
  assert.equal(expandTeam(agents, 8, 'software')[4].role, 'Senior technical architect');
});

for (const capacity of [8, 12] as const)
  test(`${capacity}-agent office has accessible desks and a meeting seat for every teammate`, () => {
    const team = expandTeam(agents, capacity, 'office'),
      office = new OfficeSimulation(capacity);
    office.update(team, [], []);
    for (const person of office.people.values())
      assert.ok(walkable(person, [], capacity), `${person.id} starts in furniture`);
    office.update(team, [], [], {
      id: 'meeting',
      projectId: 'p',
      agenda: 'Review evidence',
      trigger: 'manual',
      status: 'running',
      checkpoint: 0,
      participants: team,
      contributions: [],
      summary: '',
      speakerId: team[0].id,
      createdAt: Date.now(),
    });
    for (let frame = 0; frame < 2400; frame++) office.step(1 / 60);
    team.forEach((agent, index) => {
      const person = office.people.get(agent.id)!,
        target = meetingSeats(capacity)[index];
      assert.ok(
        Math.hypot(person.x - target.x, person.z - target.z) < 0.12,
        `${agent.name} did not reach a seat: ${person.x}, ${person.z}`,
      );
    });
    office.update(team, [], []);
    for (let frame = 0; frame < 2400; frame++) office.step(1 / 60);
    for (const person of office.people.values())
      assert.ok(
        !person.path.length &&
          Math.hypot(person.x - person.goal.x, person.z - person.goal.z) < 0.12,
        `${person.id} did not return to desk`,
      );
  });

test('planning roles use distinct board positions while engineering implementation stays at a workstation', () => {
  const team = expandTeam(agents, 12, 'office');
  team[0].role = 'Project manager';
  team[4].role = 'Supervisor';
  team[8].role = 'Senior technical architect';
  team[11].role = 'Market & customer researcher';
  const office = new OfficeSimulation(12);
  const tasks = [0, 4, 8, 11].map((index) => ({
    id: `planning-${index}`,
    projectId: 'p',
    title: 'Compare approaches using the project board',
    description: 'Compare actual proposals.',
    agentId: team[index].id,
    dependencies: [],
    status: 'working' as const,
    requiresApproval: false,
    workType: 'plan' as const,
    output: '',
    feedback: '',
  }));
  office.update(team, tasks, []);
  const positions = tasks.map((task) => office.people.get(task.agentId)!.goal);
  assert.ok(positions.every((goal) => goal.action === 'whiteboard'));
  assert.equal(new Set(positions.map((goal) => goal.x)).size, 4);
  for (let frame = 0; frame < 1800; frame++) office.step(1 / 60);
  for (const task of tasks) {
    const person = office.people.get(task.agentId)!;
    assert.ok(
      Math.hypot(person.x - person.goal.x, person.z - person.goal.z) < 0.12,
      `${person.id} did not reach the actual board`,
    );
  }
  office.update(team, [], []);
  for (let frame = 0; frame < 1800; frame++) office.step(1 / 60);
  assert.ok([...office.people.values()].every((person) => person.goal.action === 'desk'));
});
