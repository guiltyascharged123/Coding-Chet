import type { Task } from './types.js';

export type PlanTask = Pick<
  Task,
  | 'id'
  | 'title'
  | 'description'
  | 'agentId'
  | 'dependencies'
  | 'requiresApproval'
  | 'readOnly'
  | 'workType'
  | 'acceptanceCriteria'
  | 'documentKind'
>;

/** Reusable user/model plan, excluding execution-time evidence and delegated jobs. */
export function planDefinition(tasks: Task[]): PlanTask[] {
  const all = new Map(tasks.map((task) => [task.id, task]));
  const roots = tasks.filter((task) => !task.conversationMessageId && !task.requestedByTaskId);
  const rootIds = new Set(roots.map((task) => task.id));
  function owner(id: string) {
    const seen = new Set<string>();
    let task = all.get(id);
    while (task?.requestedByTaskId && !seen.has(task.id)) {
      seen.add(task.id);
      task = all.get(task.requestedByTaskId);
    }
    return task && rootIds.has(task.id) ? task.id : undefined;
  }
  return roots.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    agentId: task.agentId,
    dependencies: [
      ...new Set(task.dependencies.map(owner).filter((id): id is string => !!id && id !== task.id)),
    ],
    requiresApproval: task.requiresApproval,
    readOnly: task.readOnly,
    workType: task.workType,
    acceptanceCriteria: task.acceptanceCriteria?.some(
      (criterion) => !task.dynamicCriteriaIds?.includes(criterion.id),
    )
      ? structuredClone(
          task.acceptanceCriteria.filter(
            (criterion) => !task.dynamicCriteriaIds?.includes(criterion.id),
          ),
        )
      : undefined,
    documentKind: task.documentKind,
  }));
}
