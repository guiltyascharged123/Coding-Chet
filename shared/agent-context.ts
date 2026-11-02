import type { Agent, Project, Task } from './types.js';
import { roleProcedure } from './role-protocol.js';
import { hasProjectTools } from './capabilities.js';

export function workingStyle(project: Pick<Project, 'exploration'>) {
  return project.exploration === 'expansive'
    ? 'Exploration mode: expansive. Consider unconventional, materially different routes rather than defaulting to familiar ideas. Challenge the obvious solution, combine relevant specialties, and pursue promising reversible work autonomously within the assigned goal and available tools. Compare evidence, feasibility and downside; discard weak candidates. Do not invent completed actions or facts. Ask the human only for missing authority or a consequential choice the team cannot resolve.'
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
