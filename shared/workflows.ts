import type { Agent, Workflow } from './types.js';

export const WORKFLOWS: Record<
  Workflow,
  {
    label: string;
    description: string;
    roles: [string, string, string, string];
    goals: [string, string, string, string];
    tasks: { title: string; description: string; owner: number; approval?: boolean }[];
  }
> = {
  office: {
    label: 'Office & project coordination',
    description:
      'Produce the work the brief actually calls for, with a decision gate and quality review.',
    roles: ['Project coordinator', 'Operations specialist', 'Analyst', 'Quality reviewer'],
    goals: [
      'Define scope, acceptance criteria, owners and decisions requiring human input.',
      'Produce practical deliverables that directly advance the approved goal.',
      'Check evidence, calculations, constraints and dependencies. Label assumptions.',
      'Challenge unsupported claims, reconcile the work, and report actionable next steps.',
    ],
    tasks: [
      {
        title: 'Agree on scope and acceptance criteria',
        owner: 0,
        approval: true,
        description:
          'Translate the brief into concrete deliverables, acceptance criteria, constraints, and essential choices. Propose reasonable assumptions; ask only decisions that materially affect the work. Present the approach for human approval.',
      },
      {
        title: 'Produce the requested work',
        owner: 1,
        description:
          'Carry out the approved assignment. Create only deliverables that the brief or approved scope calls for. Do not manufacture a budget, meeting, or document just to fill a template. Identify missing evidence and clearly label estimates.',
      },
      {
        title: 'Check and reconcile the deliverables',
        owner: 2,
        description:
          'Review the work against the approved acceptance criteria. Check calculations, consistency, owners, dependencies, and evidence. Correct issues in your revised deliverable and identify unresolved decisions.',
      },
      {
        title: 'Report results and next decisions',
        owner: 3,
        description:
          'Deliver a concise user update: what was produced, where it meets the approved goal, unresolved limitations, choices needed, and the next actions with owners. Do not claim real-world actions or meetings occurred.',
      },
    ],
  },
  software: {
    label: 'Software delivery',
    description: 'Codex implements, reviews and tests actual files in one managed project folder.',
    roles: ['Technical lead', 'Implementation engineer', 'Code reviewer', 'Test engineer'],
    goals: [
      'Turn the brief into a small testable implementation, acceptance criteria and explicit constraints.',
      'Build working software, execute checks and fix failures within scope.',
      'Inspect actual code for defects, security issues and maintainability; fix findings and verify changes.',
      'Run meaningful tests against the actual implementation, fix failures and report evidence.',
    ],
    tasks: [
      {
        title: 'Approve the implementation scope',
        owner: 0,
        approval: true,
        description:
          'Inspect the project folder. Define a focused implementation, architecture, acceptance criteria, and test strategy. Identify essential choices for the user. Do not implement until this task is approved.',
      },
      {
        title: 'Implement and exercise the solution',
        owner: 1,
        description:
          'Build the approved solution in the shared project folder. Write actual source files and meaningful tests. Run available build/tests, inspect failures and fix them. Keep changes scoped. If a dependency cannot be installed with the configured network policy, report the blocker precisely rather than claiming success.',
      },
      {
        title: 'Review code and fix defects',
        owner: 2,
        description:
          'Independently read the actual implementation and tests. Review correctness, input handling, security, accessibility where relevant, and maintainability. Correct defects within scope and run relevant checks. Report remaining findings with file locations and evidence. Mark blocked if a material defect remains.',
      },
      {
        title: 'Validate the complete workflow',
        owner: 3,
        description:
          'Inspect the real files and run representative tests/builds and important error paths. Fix failures within the approved scope, then rerun affected checks. Report commands, outcomes and coverage limits. Mark blocked if acceptance criteria cannot be met.',
      },
      {
        title: 'Hand off the working project',
        owner: 0,
        description:
          'Inspect the resulting files and prior verification. Provide exact local run/test commands, delivered behavior, known limitations and user decisions. Create a README only if it helps someone use the software. Do not deploy, publish, push, or claim unexecuted tests passed.',
      },
    ],
  },
  research: {
    label: 'Research & decision support',
    description: 'Compare options, challenge assumptions, and make a usable recommendation.',
    roles: ['Research lead', 'Research analyst', 'Critical reviewer', 'Decision coordinator'],
    goals: [
      'Define the question, constraints and the evidence needed.',
      'Analyze supplied evidence and compare viable options.',
      'Challenge unsupported claims and explain uncertainty.',
      'Turn the findings into a decision and a concrete action plan.',
    ],
    tasks: [
      {
        title: 'Define the decision and evidence',
        owner: 0,
        approval: true,
        description:
          'Define the question, decision criteria, constraints, known evidence and important unknowns. Propose a practical approach for user approval. Do not imply live web research is available.',
      },
      {
        title: 'Analyze and compare options',
        owner: 1,
        description:
          'Use the supplied material to compare realistic options against the approved criteria. Cite supplied sources where possible. Mark missing evidence and assumptions; never invent citations or claim web browsing.',
      },
      {
        title: 'Challenge the analysis',
        owner: 2,
        description:
          'Check the reasoning, counterexamples, evidence quality and sensitivity to assumptions. Produce a corrected comparison and list the remaining uncertainties.',
      },
      {
        title: 'Recommend a decision and next actions',
        owner: 3,
        description:
          'Summarize the recommendation, tradeoffs, confidence and evidence gaps. Give actionable next steps and only the user choices that remain necessary.',
      },
    ],
  },
  custom: {
    label: 'Custom team & plan',
    description: 'Start with a single assignment, then edit roles, tasks and dependencies.',
    roles: ['Team lead', 'Specialist', 'Analyst', 'Reviewer'],
    goals: [
      'Coordinate the project toward its stated goal.',
      'Complete the assigned specialist work.',
      'Analyze the evidence and practical constraints.',
      'Review results against the acceptance criteria.',
    ],
    tasks: [
      {
        title: 'Define and carry out the assignment',
        owner: 0,
        approval: true,
        description:
          'Use the project brief to deliver the requested work. State assumptions, evidence, limitations and decisions needed. Customize this task and add more tasks before running when the project needs separate stages.',
      },
    ],
  },
};

export function projectTeam(workflow: Workflow, agents: Agent[]): Agent[] {
  const preset = WORKFLOWS[workflow];
  return agents.map((a, i) => ({
    ...a,
    role: preset.roles[i],
    specialty: preset.goals[i],
    goal: preset.goals[i],
  }));
}
