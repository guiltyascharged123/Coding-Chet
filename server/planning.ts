import { z } from 'zod';
import { strictResponseSchema } from '../shared/validation.js';
import type { Agent, Project } from '../shared/types.js';
import { acceptanceListSchema } from '../shared/verification.js';
import { INPUT_LIMITS } from '../shared/limits.js';
import { deliveryPlanIssues } from './delivery-plan.js';

// Keep legacy optional metadata readable; newly generated plans request the full contract.
export const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(INPUT_LIMITS.taskTitle),
        description: z.string().trim().min(1).max(INPUT_LIMITS.taskDescription),
        agentId: z.string().min(1),
        dependencies: z.array(z.number().int().min(0)).max(100),
        requiresApproval: z.boolean(),
        workType: z.enum(['plan', 'implementation', 'review', 'tests']).optional(),
        acceptanceCriteria: acceptanceListSchema.optional(),
        documentKind: z
          .enum([
            'brief',
            'project_plan',
            'budget',
            'risk_register',
            'meeting_minutes',
            'status_report',
            'notes',
          ])
          .optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type PlannedTask = z.infer<typeof planSchema>['tasks'][number];

/** Grammar constraints and prompt rules match the application validator. */
export function planOutputSchema(team: Agent[], maxTasks: number) {
  const task = planSchema.shape.tasks.element.omit({ documentKind: true }).extend({
    agentId: z.enum(team.map((agent) => agent.id) as [string, ...string[]]),
    dependencies: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(Math.max(0, maxTasks - 2)),
      )
      .max(100),
  });
  return strictResponseSchema(z.object({ tasks: z.array(task).min(1).max(maxTasks) }));
}

export function validatePlan(
  output: string,
  project: Pick<Project, 'deliveryMode'>,
  team: Agent[],
  maxTasks: number,
): { tasks: PlannedTask[]; issues: string[]; normalizations: string[] } {
  const text = output.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      tasks: [],
      normalizations: [],
      issues: [
        'Plan: return one complete JSON object with a tasks array; the reply was not valid JSON.',
      ],
    };
  }
  const normalizations: string[] = [];
  // A display label can be shortened without another inference call only when
  // its entire wording still fits in the actual assignment. Never cut scope,
  // evidence, dependencies or criteria to make a plan pass.
  if (value && typeof value === 'object' && 'tasks' in value && Array.isArray(value.tasks)) {
    for (const [index, task] of value.tasks.entries()) {
      if (
        !task ||
        typeof task !== 'object' ||
        typeof task.title !== 'string' ||
        typeof task.description !== 'string' ||
        task.title.trim().length <= INPUT_LIMITS.taskTitle
      )
        continue;
      const fullTitle = task.title.trim();
      const description = `Full task title: ${fullTitle}\n\n${task.description}`;
      if (description.length > INPUT_LIMITS.taskDescription) continue;
      let prefix = fullTitle.slice(0, 99);
      if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
      const boundary = prefix.lastIndexOf(' ');
      if (boundary >= 60) prefix = prefix.slice(0, boundary);
      task.title = prefix.trimEnd() + '…';
      task.description = description;
      normalizations.push(
        `Task ${index + 1}: shortened the display title to fit 100 characters; its complete original wording is preserved in the assignment description. No extra model request was needed.`,
      );
    }
  }
  const parsed = planSchema.safeParse(value);
  if (!parsed.success)
    return {
      tasks: [],
      normalizations,
      issues: parsed.error.issues.slice(0, 8).map((issue) => {
        const [root, index, ...fields] = issue.path;
        const path =
          root === 'tasks' && typeof index === 'number'
            ? `Task ${index + 1}${fields.length ? ` · ${fields.join('.')}` : ''}`
            : 'Plan tasks';
        const received = issue.path.reduce<unknown>(
          (entry, key) =>
            entry && typeof entry === 'object'
              ? (entry as Record<PropertyKey, unknown>)[key]
              : undefined,
          value,
        );
        return `${path}: ${issue.message}${issue.code === 'too_big' && typeof received === 'string' ? ` (received ${received.length} characters)` : ''}`;
      }),
    };
  const issues: string[] = [];
  if (parsed.data.tasks.length > maxTasks)
    issues.push(
      `Plan tasks: received ${parsed.data.tasks.length}; the configured project limit is ${maxTasks}. Return a complete plan within that limit.`,
    );
  for (const [index, task] of parsed.data.tasks.entries()) {
    if (!team.some((agent) => agent.id === task.agentId))
      issues.push(
        `Task ${index + 1} · agentId: use one of this team's exact IDs: ${team.map((agent) => agent.id).join(', ')}.`,
      );
    if (task.dependencies.some((dependency) => dependency >= index))
      issues.push(
        `Task ${index + 1} · dependencies: invalid or circular dependency. Use only zero-based indexes of earlier tasks${index ? ` (0–${index - 1})` : '; the first task must use []'}.`,
      );
  }
  if (!issues.length) issues.push(...deliveryPlanIssues(project, parsed.data.tasks));
  return { tasks: parsed.data.tasks, issues: issues.slice(0, 8), normalizations };
}
