import type { Activity, Agent, Task } from '../../shared/types';

export type Point = { x: number; z: number };
export const DESKS: [number, number, number][] = [
  [-4.3, 0, -2.4],
  [3.6, 0, -2.4],
  [-4.3, 0, 2.7],
  [3.6, 0, 2.7],
];
export type Action = 'desk' | 'coffee' | 'whiteboard' | 'meeting' | 'printer' | 'handoff';
type Goal = Point & { action: Action; label: string; facing: number };
export type Person = Point & {
  id: string;
  heading: number;
  walking: boolean;
  distance: number;
  goal: Goal;
  path: Point[];
  waitUntil: number;
  blocked: number;
  visits: number;
  taskKey: string;
  status?: string;
  peer?: string;
};

// Footprints include clearance for a character. Rugs are walkable. The chairs,
// shelves, equipment, walls, and meeting table are not.
const furniture = [
  ...DESKS.flatMap(([x, , z]) => [
    { x, z, halfX: 1.85, halfZ: 1.1 },
    { x, z: z + 1.1, halfX: 0.83, halfZ: 0.9 },
  ]),
  { x: 0, z: -1.2, halfX: 2.12, halfZ: 1.68 },
  { x: -5.5, z: -5.9, halfX: 2.1, halfZ: 0.68 },
  { x: 7.5, z: 0.3, halfX: 0.95, halfZ: 1.55 },
  { x: -7.4, z: 1.2, halfX: 0.95, halfZ: 1.0 },
  ...[
    [-7.5, -5.3],
    [7.6, -5.2],
    [-7.6, 5.3],
    [7.3, 5.4],
  ].map(([x, z]) => ({ x, z, halfX: 0.75, halfZ: 0.75 })),
];
export function walkable(point: Point, people: Point[] = []) {
  return (
    Math.abs(point.x) <= 7.95 &&
    point.z >= -5.85 &&
    point.z <= 6.0 &&
    !furniture.some(
      (r) => Math.abs(point.x - r.x) < r.halfX && Math.abs(point.z - r.z) < r.halfZ,
    ) &&
    !people.some((p) => Math.hypot(point.x - p.x, point.z - p.z) < 0.9)
  );
}
function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function clearSegment(a: Point, b: Point, people: Point[] = []) {
  if (!walkable(b, people)) return false;
  const dx = b.x - a.x,
    dz = b.z - a.z;
  // Exact segment/rectangle intersection avoids clipping even a tiny corner
  // between grid samples. Boundary contact is allowed at numerical precision.
  for (const r of furniture) {
    let enter = 0,
      leave = 1;
    for (const [origin, delta, low, high] of [
      [a.x, dx, r.x - r.halfX + 0.00001, r.x + r.halfX - 0.00001],
      [a.z, dz, r.z - r.halfZ + 0.00001, r.z + r.halfZ - 0.00001],
    ]) {
      if (Math.abs(delta) < 0.000001) {
        if (origin <= low || origin >= high) {
          enter = 2;
          break;
        }
        continue;
      }
      const one = (low - origin) / delta,
        two = (high - origin) / delta;
      enter = Math.max(enter, Math.min(one, two));
      leave = Math.min(leave, Math.max(one, two));
    }
    if (enter <= leave && enter <= 1 && leave >= 0) return false;
  }
  for (const person of people) {
    const t = Math.max(
      0,
      Math.min(1, ((person.x - a.x) * dx + (person.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
    );
    if (
      distance(person, { x: a.x + t * dx, z: a.z + t * dz }) < 0.9 &&
      !(distance(a, person) < 0.9 && (a.x - person.x) * dx + (a.z - person.z) * dz >= 0)
    )
      return false;
  }
  return true;
}

/** A* on an office floor grid, then line-of-sight smoothing. No diagonal corner cuts. */
export function route(start: Point, goal: Point, people: Point[] = []): Point[] {
  if (!walkable(goal, people)) return [];
  if (clearSegment(start, goal, people)) return [goal];
  const size = 0.3,
    width = 55;
  const node = (p: Point) => ({
    x: Math.round((p.x + 8.1) / size),
    z: Math.round((p.z + 6) / size),
  });
  const world = (x: number, z: number) => ({ x: x * size - 8.1, z: z * size - 6 });
  const first = node(start),
    last = node(goal);
  const key = (x: number, z: number) => z * width + x;
  const firstKey = key(first.x, first.z);
  const scores = new Map([[firstKey, 0]]),
    parents = new Map<number, number>();
  const open = [{ ...first, score: distance(start, goal) }],
    closed = new Set<number>();
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].score < open[best].score) best = i;
    const current = open.splice(best, 1)[0],
      id = key(current.x, current.z);
    if (closed.has(id)) continue;
    closed.add(id);
    const currentPoint = world(current.x, current.z);
    if (
      Math.abs(current.x - last.x) <= 1 &&
      Math.abs(current.z - last.z) <= 1 &&
      clearSegment(currentPoint, goal, people)
    ) {
      const path: Point[] = [goal, currentPoint];
      let cursor = id;
      while (parents.has(cursor)) {
        cursor = parents.get(cursor)!;
        if (cursor !== firstKey) path.push(world(cursor % width, Math.floor(cursor / width)));
      }
      path.push(start);
      path.reverse();
      const smooth: Point[] = [];
      let index = 0;
      while (index < path.length - 1) {
        let next = path.length - 1;
        while (next > index + 1 && !clearSegment(path[index], path[next], people)) next--;
        smooth.push(path[next]);
        index = next;
      }
      return smooth;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const x = current.x + dx,
        z = current.z + dz;
      if (x < 0 || x >= width || z < 0 || z > 40) continue;
      const nextId = key(x, z),
        point = world(x, z);
      if (
        closed.has(nextId) ||
        !clearSegment(id === firstKey ? start : currentPoint, point, people)
      )
        continue;
      const cost = scores.get(id)! + Math.hypot(dx, dz);
      if (cost >= (scores.get(nextId) ?? Infinity)) continue;
      scores.set(nextId, cost);
      parents.set(nextId, id);
      open.push({ x, z, score: cost + distance(point, goal) / size });
    }
  }
  return [];
}

function desk(agent: Agent): Goal {
  const [x, , z] = DESKS[agent.desk];
  return { x, z: z + 2.16, action: 'desk', label: 'their desk', facing: Math.PI };
}
function station(action: Action, index: number): Goal {
  switch (action) {
    case 'coffee':
      return {
        x: 6.25,
        z: -0.8 + index * 0.9,
        action,
        label: 'the coffee counter',
        facing: Math.PI / 2,
      };
    case 'whiteboard':
      return {
        x: 2.0 + index * 0.9,
        z: -5.15,
        action,
        label: 'the planning wall',
        facing: Math.PI,
      };
    case 'printer':
      return {
        x: -6.25,
        z: 0.1 + index * 0.9,
        action,
        label: 'the printer',
        facing: -Math.PI / 2,
      };
    default:
      return {
        x: index % 2 === 0 ? -0.75 : 0.75,
        z: 1.45 + Math.floor(index / 2) * 1.2,
        action,
        label: action === 'handoff' ? 'a team handoff' : 'the meeting area',
        facing: index % 2 === 0 ? Math.PI / 2 : -Math.PI / 2,
      };
  }
}

export class OfficeSimulation {
  people = new Map<string, Person>();
  time = 0;
  private team: Agent[] = [];
  private seen = new Set<string>();
  private encounter?: { a: string; b: string; started: number; settled?: number };
  update(agents: Agent[], tasks: Task[], activities: Activity[]) {
    this.team = agents;
    for (const [index, agent] of agents.entries()) {
      let person = this.people.get(agent.id);
      if (!person) {
        const goal = desk(agent);
        person = {
          ...goal,
          id: agent.id,
          heading: Math.PI,
          walking: false,
          distance: 0,
          goal,
          path: [],
          waitUntil: this.time + 0.7 + index * 1.2,
          blocked: 0,
          visits: index,
          taskKey: '',
        };
        this.people.set(agent.id, person);
      }
      const task = tasks.find(
        (t) => t.agentId === agent.id && (t.status === 'working' || t.status === 'review'),
      );
      const taskKey = task ? `${task.id}:${task.status}` : '';
      person.status = task?.status;
      if (person.taskKey !== taskKey) {
        person.taskKey = taskKey;
        if (!person.peer)
          this.send(person, task?.status === 'review' ? station('whiteboard', index) : desk(agent));
      } else if (
        person.goal.action === 'desk' &&
        (person.goal.x !== desk(agent).x || person.goal.z !== desk(agent).z)
      ) {
        this.send(person, desk(agent));
      }
    }
    // Replay fresh runtime handoffs, never old history on every SSE snapshot.
    for (const event of [...activities].reverse()) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      if (
        this.encounter ||
        !event.agentId ||
        !event.targetAgentId ||
        event.agentId === event.targetAgentId ||
        Date.now() - event.createdAt > 10_000
      )
        continue;
      const a = this.people.get(event.agentId),
        b = this.people.get(event.targetAgentId);
      if (!a || !b) continue;
      this.encounter = { a: a.id, b: b.id, started: this.time };
      a.peer = b.id;
      b.peer = a.id;
      this.send(a, station('handoff', 0));
      this.send(b, station('handoff', 1));
    }
  }
  private send(person: Person, goal: Goal) {
    person.goal = goal;
    person.path = route(person, goal);
    person.waitUntil = this.time + 4;
    person.blocked = 0;
  }
  step(delta: number) {
    // Keep low frame rates in real time with small collision steps. A resumed
    // background tab advances only one short frame instead of fast-forwarding.
    let remaining = delta > 1 ? 0.06 : Math.min(delta, 0.25);
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 30);
      this.advance(dt);
      remaining -= dt;
    }
  }
  private advance(dt: number) {
    this.time += dt;
    if (this.encounter) {
      const { a, b, started } = this.encounter,
        pa = this.people.get(a)!,
        pb = this.people.get(b)!;
      if (distance(pa, pa.goal) < 0.08 && distance(pb, pb.goal) < 0.08)
        this.encounter.settled ??= this.time;
      if (
        this.time - started > 30 ||
        (this.encounter.settled !== undefined && this.time - this.encounter.settled > 3.5)
      ) {
        for (const p of [pa, pb]) {
          p.peer = undefined;
          const agent = this.team.find((a) => a.id === p.id)!;
          this.send(
            p,
            p.status === 'review' ? station('whiteboard', this.team.indexOf(agent)) : desk(agent),
          );
        }
        this.encounter = undefined;
      }
    }
    for (const [index, agent] of this.team.entries()) {
      const p = this.people.get(agent.id)!;
      if (!p.path.length && distance(p, p.goal) > 0.1) {
        p.blocked += dt;
        if (p.blocked > 0.7) {
          p.path = route(
            p,
            p.goal,
            [...this.people.values()].filter((q) => q !== p),
          );
          p.blocked = 0;
        }
      }
      if (!p.path.length && distance(p, p.goal) < 0.1 && !p.peer && this.time > p.waitUntil) {
        if (p.status === 'review') p.waitUntil = this.time + 8;
        else if (p.status === 'working') {
          // Long model/worker tasks alternate focused desk work and planning.
          this.send(p, p.goal.action === 'desk' ? station('whiteboard', index) : desk(agent));
          p.waitUntil = this.time + 12;
        } else {
          const visits: Action[] = ['coffee', 'whiteboard', 'meeting', 'printer', 'desk'];
          const action = visits[p.visits++ % visits.length];
          this.send(p, action === 'desk' ? desk(agent) : station(action, index));
        }
      }
      p.walking = false;
      const next = p.path[0];
      if (!next) {
        const angle = Math.atan2(
          Math.sin(p.goal.facing - p.heading),
          Math.cos(p.goal.facing - p.heading),
        );
        p.heading += angle * Math.min(1, dt * 7);
        continue;
      }
      const length = distance(p, next),
        speed = 1.35,
        step = Math.min(length, speed * dt);
      const candidate = {
        x: p.x + ((next.x - p.x) / Math.max(length, 0.001)) * step,
        z: p.z + ((next.z - p.z) / Math.max(length, 0.001)) * step,
      };
      const blocked = [...this.people.values()].some(
        (q) => q !== p && distance(candidate, q) < 0.84 && distance(candidate, q) < distance(p, q),
      );
      if (blocked) {
        p.blocked += dt;
        if (p.blocked > 0.65 + index * 0.12) {
          p.path = route(
            p,
            p.goal,
            [...this.people.values()].filter((q) => q !== p),
          );
          p.blocked = 0;
        }
        continue;
      }
      p.blocked = 0;
      p.walking = true;
      p.distance += step;
      const heading = Math.atan2(next.x - p.x, next.z - p.z);
      p.heading +=
        Math.atan2(Math.sin(heading - p.heading), Math.cos(heading - p.heading)) *
        Math.min(1, dt * 10);
      p.x = candidate.x;
      p.z = candidate.z;
      if (length <= step + 0.000001) {
        p.path.shift();
        if (!p.path.length)
          p.waitUntil = this.time + (p.status === 'working' ? 12 : 4.5 + index * 0.7);
      }
    }
  }
}
