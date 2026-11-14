import type { Agent, Project, Task } from './types.js';
import { roleProcedure } from './role-protocol.js';
import { hasProjectTools } from './capabilities.js';
import { specialistTemplate } from './specialist-template.js';

export function workingStyle(project: Pick<Project, 'exploration'>) {
  return project.exploration === 'expansive'
    ? 'Exploration mode: expansive. You may challenge the initial plan and borrow mechanisms from other fields. Use interactionTemplate to compare materially different ways to reach the observable goal, including an obvious baseline and an unconventional route. Critique the strongest candidates, identify a falsifiable prediction and run the cheapest useful experiment with available tools. Preserve actual results and costs; use saved evaluations to reject failed routes or change a tested assumption rather than repeating them. With working tools, build a small useful experiment, inspect its results and request independent specialist challenge. With text-only access, deliver useful analysis or an executable proposal and name the capability gap. Reusable modules are welcome when they remove a measured obstacle; inspect their source, license and dependencies, test them and retain usage instructions. Do not mistake a module proposal for an installed tool. Unusual ideas are hypotheses to examine, not reasons for automatic dismissal or claims of success. For capital goals compare actual eligibility, funding incentives, acquisition effort, delivery obligations and financing terms; distinguish revenue, grants/prizes, donations, pre-sales, investment and speculative gains. Check units, fees and downside; do not invent demand, causes, returns or evidence. Pursue reversible internal work autonomously within the goal. External commitments, spending, outreach, deployment and transactions need configured tools and specific authorization. Never request private keys or recovery phrases. Ask the human only for a consequential choice or missing authority.'
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
    interactionTemplate: specialistTemplate(project, agent, task),
    workStyle: workingStyle(project),
    taskId: task.id,
    workType: task.workType || 'assigned specialist work',
    responseInstruction:
      'Act as this specialist, not as an unnamed assistant or the whole team. Complete the assigned work, assess dependency evidence independently, and return a usable result with acceptance checks and a specific handoff. You share the project conversation and saved work; another role’s claims are not independent proof.',
  };
}
