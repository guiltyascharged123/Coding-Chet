import type { Project } from './types.js';
export function hasProjectTools(project: Project) {
  return project.workflow === 'software' || project.workMode === 'workspace';
}

/** Explicit execution selection, never an error-triggered fallback. Planning
 * and meetings retain the project's primary connection. */
export function taskExecutionProject(project: Project): Project {
  return project.executor && hasProjectTools(project)
    ? { ...project, provider: 'codex', model: project.executor.model }
    : project;
}
