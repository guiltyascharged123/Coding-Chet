import type { Agent, Workflow } from './types.js';
import { SPECIALISTS } from './specialists.js';
import { z } from 'zod';

export const AGENT_IDS = [
  'mira',
  'sol',
  'atlas',
  'echo',
  'nova',
  'jules',
  'reed',
  'cleo',
  'aria',
  'finn',
  'max',
  'sage',
] as const;
export const OFFICE_CAPACITIES = [4, 8, 12] as const;
export type OfficeCapacity = (typeof OFFICE_CAPACITIES)[number];
export const teamMemberSchema = z.object({
  id: z.enum(AGENT_IDS),
  name: z.string().trim().min(1).max(30),
  role: z.string().trim().min(2).max(50),
  specialty: z.string().trim().min(5).max(600),
  goal: z.string().max(1000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  desk: z.number().int().min(0).max(11),
});
const colors = [
  '#5285b5',
  '#bd914b',
  '#428578',
  '#ad6b50',
  '#7986b8',
  '#8e9470',
  '#4f929d',
  '#bd806b',
  '#a488b5',
  '#8e9ea1',
  '#a48d62',
  '#6e9a83',
];
export function specialistAgent(index: number, role: string): Agent {
  const preset =
    SPECIALISTS.find((s) => s.role === role) || SPECIALISTS[index % SPECIALISTS.length];
  const id = AGENT_IDS[index];
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    desk: index,
    color: colors[index],
    ...preset,
  };
}
export function expandTeam(team: Agent[], capacity: OfficeCapacity, workflow?: Workflow) {
  const result = structuredClone(team);
  const extra =
    workflow === 'software'
      ? [
          'Senior technical architect',
          'Security & privacy reviewer',
          'Product & UX specialist',
          'Technical writer',
          'Automation engineer',
          'Data analyst',
          'Product manager',
          'Project coordinator',
        ]
      : [
          'Senior software engineer',
          'Market & customer researcher',
          'Financial & risk analyst',
          'Technical writer',
          'Automation engineer',
          'Product & UX specialist',
          'Procurement & vendor analyst',
          'Communications strategist',
        ];
  for (let index = 0; index < AGENT_IDS.length && result.length < capacity; index++) {
    if (result.some((agent) => agent.id === AGENT_IDS[index])) continue;
    const agent = specialistAgent(index, extra[Math.max(0, index - 4) % extra.length]);
    agent.desk = Array.from({ length: capacity }, (_, n) => n).find(
      (n) => !result.some((a) => a.desk === n),
    )!;
    result.push(agent);
  }
  return result;
}
