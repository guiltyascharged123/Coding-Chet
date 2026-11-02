import type { Project, Task } from '../shared/types.js';

type Planned = Pick<Task, 'agentId' | 'workType' | 'acceptanceCriteria'> & {
  dependencies: number[];
};
export function deliveryPlanIssues(project: Pick<Project, 'deliveryMode'>, tasks: Planned[]) {
  if (project.deliveryMode === 'design')
    return tasks.some((task) => task.workType === 'implementation')
      ? [
          'Design-only plans cannot include implementation; choose Working software when file changes are intended.',
        ]
      : [];
  if (project.deliveryMode !== 'build') return [];
  const implementation = tasks
    .map((task, index) => (task.workType === 'implementation' ? index : -1))
    .filter((index) => index >= 0);
  const issues: string[] = [];
  if (!implementation.length)
    issues.push('Working software needs an implementation assignment, not only reports.');
  function after(index: number, target: number, seen = new Set<number>()): boolean {
    if (seen.has(index) || !tasks[index]) return false;
    seen.add(index);
    return tasks[index].dependencies.some(
      (dependency) => dependency === target || after(dependency, target, seen),
    );
  }
  for (const implementationIndex of implementation) {
    if (
      !tasks.some(
        (task, index) =>
          task.workType === 'review' &&
          task.agentId !== tasks[implementationIndex].agentId &&
          after(index, implementationIndex),
      )
    )
      issues.push(
        'Working software needs an independent reviewer after each implementation assignment.',
      );
    if (
      !tasks.some((task, index) => task.workType === 'tests' && after(index, implementationIndex))
    )
      issues.push(
        'Working software needs executed verification after each implementation assignment.',
      );
  }
  for (const task of tasks) {
    const kinds = task.acceptanceCriteria?.map((criterion) => criterion.evidence) || [];
    const expected =
      task.workType === 'implementation'
        ? ['artifact', 'verification']
        : task.workType === 'review'
          ? ['inspection']
          : task.workType === 'tests'
            ? ['verification']
            : ['report'];
    if (expected.some((kind) => !kinds.includes(kind as (typeof kinds)[number])))
      issues.push(
        `A ${task.workType || 'untyped'} assignment lacks its required acceptance evidence (${expected.join(', ')}).`,
      );
  }
  return [...new Set(issues)];
}
