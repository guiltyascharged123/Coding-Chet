import { randomUUID } from 'node:crypto';
import type { Agent, Project, Task } from '../shared/types.js';
import { WORKFLOWS } from '../shared/workflows.js';
import { demoPlan } from './seed.js';

export function templatePlan(project: Project, team: Agent[]): Task[] {
  // Existing projects and explicit legacy packs retain their original contracts.
  if (!project.workflow) return demoPlan(project, team);
  let previous: string | undefined;
  return WORKFLOWS[project.workflow].tasks.map((t) => {
    const id = randomUUID();
    const task: Task = {
      id,
      projectId: project.id,
      title: t.title,
      description: t.description,
      agentId: team[t.owner].id,
      dependencies: previous ? [previous] : [],
      // Real teams ask a specific question when needed; the demo retains its guided review.
      requiresApproval: project.provider === 'demo' && !!t.approval,
      readOnly: project.workflow === 'software' && !!t.approval,
      status: 'queued',
      output: '',
      feedback: '',
    };
    previous = id;
    return task;
  });
}
