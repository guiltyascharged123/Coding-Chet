import type { Agent, Project, Task, WorkspaceState } from '../shared/types.js';
import { randomUUID } from 'node:crypto';

export const agents: Agent[] = [
  {
    id: 'mira',
    name: 'Mira',
    role: 'Team lead',
    specialty: 'Finds the right problem, sets the direction, and brings everyone together.',
    color: '#8c9cf5',
    desk: 0,
  },
  {
    id: 'sol',
    name: 'Sol',
    role: 'Designer',
    specialty: 'Turns a clear strategy into a distinctive visual language and experience.',
    color: '#f1b94b',
    desk: 1,
  },
  {
    id: 'atlas',
    name: 'Atlas',
    role: 'Engineer',
    specialty: 'Translates ideas into practical technical specifications and implementation plans.',
    color: '#68b49b',
    desk: 2,
  },
  {
    id: 'echo',
    name: 'Echo',
    role: 'Reviewer',
    specialty: 'Challenges assumptions, checks quality, and catches the details.',
    color: '#d28ba8',
    desk: 3,
  },
];

export function demoPlan(project: Project, team: Agent[]): Task[] {
  const titles = [
    'Set the direction',
    'Explore the creative direction',
    'Map the experience',
    'Build the implementation plan',
    'Review the details',
    'Bring it all together',
  ];
  const descriptions = [
    'Clarify the audience, goals, constraints, and what success looks like. Create an actionable project brief.',
    'Propose a cohesive visual direction, tone of voice, and design principles. Ask the human to approve this direction before implementation.',
    'Use the approved direction to outline user journeys, information architecture, and key interactions.',
    'Produce a concrete implementation plan, component structure, acceptance criteria, and a small illustrative code example where useful.',
    'Review all previous work for accessibility, consistency, missing requirements, and practical risks. Provide a prioritized checklist.',
    'Synthesize the team’s work into a coherent handoff with decisions, deliverables, and clear next steps.',
  ];
  const ids = titles.map(() => randomUUID());
  const assignments = [0, 1, 1, 2, 3, 0];
  const deps = [[], [0], [1], [2], [3], [4]];
  return titles.map((title, i) => ({
    id: ids[i],
    projectId: project.id,
    title,
    description: descriptions[i],
    agentId: team[assignments[i] % team.length].id,
    dependencies: deps[i].map((n) => ids[n]),
    status: 'queued',
    requiresApproval: i === 1,
    output: '',
    feedback: '',
  }));
}

export function initialState(): WorkspaceState {
  const project: Project = {
    id: randomUUID(),
    title: 'Sunday Coffee',
    brief:
      'Create a warm, thoughtful brand and a simple launch website for Sunday Coffee, an independent neighborhood coffee shop. Make it welcoming, accessible, and a little unexpected. The audience is people who appreciate a slower, better morning.',
    status: 'ready',
    createdAt: Date.now(),
    provider: 'demo',
  };
  return {
    agents: structuredClone(agents),
    projects: [project],
    tasks: demoPlan(project, agents),
    provider: 'demo',
    approvals: [],
    activities: [
      {
        id: randomUUID(),
        projectId: project.id,
        agentId: 'mira',
        type: 'system',
        message: 'Your brief is mapped into six tasks. We’re ready when you are.',
        createdAt: Date.now(),
      },
      {
        id: randomUUID(),
        projectId: project.id,
        type: 'system',
        message:
          'Four specialists have joined the studio. Start the team to watch the workflow unfold.',
        createdAt: Date.now() - 1000,
      },
    ],
  };
}
