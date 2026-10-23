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
      'Produce the work the brief actually calls for, with autonomous planning and quality review.',
    roles: ['Project coordinator', 'Operations specialist', 'Analyst', 'Quality reviewer'],
    goals: [
      'Define scope, acceptance criteria, owners and decisions requiring human input.',
      'Produce practical deliverables that directly advance the approved goal.',
      'Check evidence, calculations, constraints and dependencies. Label assumptions.',
      'Challenge unsupported claims, reconcile the work, and report actionable next steps.',
    ],
    tasks: [
      {
        title: 'Define scope and acceptance criteria',
        owner: 0,
        approval: true,
        description:
          'Translate the brief into concrete deliverables, acceptance criteria, constraints, and essential choices. Proceed with explicit reversible assumptions; request human input only when a material choice or authority is missing. Give downstream specialists concrete direction.',
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
        title: 'Inspect and define the implementation scope',
        owner: 0,
        approval: true,
        description:
          'Inspect the project folder. Define a focused implementation, architecture, acceptance criteria, and test strategy within the brief. Record reasonable reversible assumptions and proceed. Report a blocker if a missing requirement materially prevents useful implementation. This first task inspects and plans; later tasks implement.',
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
          'Define the question, decision criteria, constraints, known evidence and important unknowns. Choose a practical approach within the brief. Ask only a material unresolved human choice; proceed with labeled reversible assumptions otherwise. Identify needed evidence and available tools. Do not claim research was performed when it was not.',
      },
      {
        title: 'Analyze and compare options',
        owner: 1,
        description:
          'Use supplied material and, when Codex research is enabled, current cited web sources to compare realistic options against the approved criteria. Mark missing evidence and assumptions; never invent citations or claim research you did not perform.',
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
  venture: {
    label: 'Venture & opportunity validation',
    description:
      'Challenge business ideas, compare alternatives and test an actual advantage before building.',
    roles: [
      'Project manager',
      'Commercial strategist',
      'Market & customer researcher',
      'Financial & risk analyst',
    ],
    goals: [
      'Define measurable outcomes, constraints, milestones and human decisions; keep the team focused on evidence and viable execution.',
      'Find a specific buyer problem, distribution advantage and business model that survives competition from ChatGPT and existing tools.',
      'Challenge demand, differentiation, customer access and willingness-to-pay assumptions. Never invent market research or customers.',
      'Check unit economics, acquisition and delivery costs, downside risk, and the cheapest experiment with clear go/stop criteria.',
    ],
    tasks: [
      {
        title: 'Define constraints and opportunity criteria',
        owner: 0,
        approval: true,
        description:
          'Clarify available skills/assets, budget, time, geography, risk tolerance and the intended financial outcome. Do not invent missing constraints. Define what would count as a credible opportunity and a useful first validation. Ask the user only essential decisions.',
      },
      {
        title: 'Compare differentiated opportunities',
        owner: 1,
        description:
          'Compare at least three materially different approaches. For each identify a specific buyer, costly recurring problem, distribution route, competing alternatives including ChatGPT/Codex, and a reason the buyer would pay. Reject generic AI services without a credible advantage. Rank against the approved constraints and explicitly label evidence gaps.',
      },
      {
        title: 'Challenge demand and competitive advantage',
        owner: 2,
        description:
          'Independently critique the strongest options. Explain why customers might not pay, why existing tools may be sufficient, and whether distribution is realistic. Do not invent interviews, demand or citations. Improve the best candidate or reject all if none is defensible.',
      },
      {
        title: 'Design the cheapest decision-making experiment',
        owner: 3,
        approval: true,
        description:
          'Estimate plausible unit economics with clearly marked assumptions and sensitivity to acquisition/delivery costs. Propose a small validation experiment, success and stop thresholds, spending ceiling, owner and next action. Ask approval for any external action. Do not claim revenue or validated demand.',
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
