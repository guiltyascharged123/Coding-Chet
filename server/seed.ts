import type { Agent, DocumentKind, Project, Task, WorkspaceState } from '../shared/types.js';
import { randomUUID } from 'node:crypto';

export const agents: Agent[] = [
  {
    id: 'mira',
    name: 'Mira',
    role: 'Team lead',
    specialty: 'Finds the right problem, sets the direction, and brings everyone together.',
    color: '#5285b5',
    desk: 0,
  },
  {
    id: 'sol',
    name: 'Sol',
    role: 'Designer',
    specialty: 'Turns a clear strategy into a distinctive visual language and experience.',
    color: '#bd914b',
    desk: 1,
  },
  {
    id: 'atlas',
    name: 'Atlas',
    role: 'Engineer',
    specialty: 'Translates ideas into practical technical specifications and implementation plans.',
    color: '#428578',
    desk: 2,
  },
  {
    id: 'echo',
    name: 'Echo',
    role: 'Reviewer',
    specialty: 'Challenges assumptions, checks quality, and catches the details.',
    color: '#ad6b50',
    desk: 3,
  },
];

export function demoPlan(project: Project, team: Agent[]): Task[] {
  const office = project.documentPack === 'office';
  const titles = office
    ? [
        'Project brief & scope',
        'Project plan & action register',
        'Budget & resource estimate',
        'Risk & decision register',
        'Meeting agenda & minutes',
        'Project status report',
      ]
    : [
        'Set the direction',
        'Explore the creative direction',
        'Map the experience',
        'Build the implementation plan',
        'Review the details',
        'Bring it all together',
      ];
  const descriptions = office
    ? [
        'Write an executive brief with goals, scope, deliverables, constraints, and success measures. Separate known requirements from assumptions.',
        'Create a milestone schedule and action register with owners, dependencies, and proposed relative dates. Request human approval before estimating resources.',
        'Create an itemized budget table with Item, Quantity, Unit cost, and Estimated total columns. Label every cost as a planning assumption, not a quote. State the currency.',
        'Compile a risk register with owners, likelihood, impact, and mitigations, plus a decision log. Do not invent approved decisions.',
        'Prepare a kickoff agenda, a blank minutes form, and an action log. Clearly mark this as a meeting template, not evidence a meeting occurred.',
        'Write an executive status report covering document readiness, milestones, budget assumptions, open decisions, and next steps. Do not claim real-world implementation happened.',
      ]
    : [
        'Clarify the audience, goals, constraints, and what success looks like. Create an actionable project brief.',
        'Propose a cohesive visual direction, tone of voice, and design principles. Ask the human to approve this direction before implementation.',
        'Use the approved direction to outline user journeys, information architecture, and key interactions.',
        'Produce a concrete implementation plan, component structure, acceptance criteria, and a small illustrative code example where useful.',
        'Review all previous work for accessibility, consistency, missing requirements, and practical risks. Provide a prioritized checklist.',
        'Synthesize the team’s work into a coherent handoff with decisions, deliverables, and clear next steps.',
      ];
  const ids = titles.map(() => randomUUID());
  const assignments = office ? [0, 1, 2, 2, 3, 0] : [0, 1, 1, 2, 3, 0];
  const kinds: DocumentKind[] = [
    'brief',
    'project_plan',
    'budget',
    'risk_register',
    'meeting_minutes',
    'status_report',
  ];
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
    documentKind: office ? kinds[i] : i === 0 ? 'brief' : 'notes',
    output: '',
    feedback: '',
  }));
}

export function initialState(demo = true): WorkspaceState {
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
    projects: demo ? [project] : [],
    tasks: demo ? demoPlan(project, agents) : [],
    provider: 'demo',
    approvals: [],
    activities: demo
      ? [
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
        ]
      : [],
  };
}
