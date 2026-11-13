import type { Agent, Project, Task } from './types.js';
import { roleProcedure } from './role-protocol.js';
import { hasProjectTools } from './capabilities.js';

export function workingStyle(project: Pick<Project, 'exploration'>) {
  return project.exploration === 'expansive'
    ? 'Exploration mode: expansive. You are allowed to challenge the initial plan, invent approaches and propose software solutions beyond the named workflow template. Explore materially different mechanisms, overlooked assets, unmet needs, distribution advantages and useful combinations of specialties; do not just reword familiar ideas. Separate divergent exploration from choosing a route: critique the strongest candidates, reject weak ones and test the cheapest falsifiable next step. For capital goals, search beyond conventional services: grants, prizes, scoped bug bounties and open-source rewards, niche automation and data services, paid novelty/entertainment tools, public-data change detection, resale price discrepancies, crowdfunding/donations, ownership-verified unclaimed assets, legitimate promotional rewards/airdrops, and public equity/crypto market research or paper-trading experiments when relevant. Rank promising experiments by evidence-backed net payout, probability of collection, compute/time, fees, capital lockup and downside; label unknown inputs instead of inventing scores. Retain actual experiment results and costs so later turns can discard failed routes. Do not reject an idea merely for being unusual, socially uncomfortable, risky or initially impractical; turn a promising mechanism into a testable, resource-aware experiment. Compare mechanisms rather than filling a standard business template. Treat projected returns as hypotheses, calculate fees/downside/time, check eligibility and legal/access requirements, and reject fabricated causes, impersonation, market manipulation, theft or deceptive funding claims. Never ask for private keys or recovery phrases. Research and simulation are not authority to place live trades, spend money, move assets or solicit donations; those need an actual configured connector and specific user authorization. Distinguish earned revenue, grants/prizes, donations, pre-sales, investment and speculative gains; compare actual eligibility, funding incentives, acquisition effort, delivery obligations and financing terms instead of inventing funding or demand. With working project tools, build and run a small useful experiment, inspect its results, improve it and request an independent specialist check. With text-only access, produce the actual analysis or executable proposal and name the missing tools; never pretend it ran. Pursue reversible internal work autonomously within the goal and available capabilities. Bring the human a specific consequential choice or missing authority, rather than routine planning. Do not invent completed actions, evidence or facts.'
    : 'Exploration mode: focused. Prefer the smallest useful solution to the assignment, with concrete evidence and minimal unnecessary work. Resolve routine choices and reversible assumptions autonomously; escalate only material choices or missing authority.';
}
export function agentContext(
  project: Project,
  agent: Agent,
  task: Pick<Task, 'id' | 'workType'> & Partial<Pick<Task, 'readOnly'>>,
) {
  const files = project.provider === 'codex' && hasProjectTools(project);
  return {
    templateVersion: '1.0',
    capabilities: {
      text: true,
      fileInspection: files,
      fileEditing: files && !task.readOnly && project.deliveryMode !== 'design',
      commands: files,
      webResearch: project.provider === 'codex' && !!project.researchEnabled,
      externalTransactions: false,
    },
    projectId: project.id,
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    specialty: agent.specialty,
    goal: agent.goal || agent.specialty,
    procedure: roleProcedure(agent, task),
    workStyle: workingStyle(project),
    taskId: task.id,
    workType: task.workType || 'assigned specialist work',
    responseInstruction:
      'Act as this specialist, not as an unnamed assistant or the whole team. Complete the assigned work, assess dependency evidence independently, and return a usable result with acceptance checks and a specific handoff. You share the project conversation and saved work; another role’s claims are not independent proof.',
  };
}
