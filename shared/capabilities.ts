import type { Project } from './types.js';
export function hasProjectTools(project: Project) {
  return project.workflow === 'software' || project.workMode === 'workspace';
}
