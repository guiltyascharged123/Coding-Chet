import type { Project } from './types.js';
export function hasProjectTools(project: Pick<Project, 'workflow' | 'workMode'>) {
  return (
    project.workflow === 'software' ||
    project.workMode === 'workspace' ||
    project.workMode === 'container'
  );
}

/** Capabilities of task execution, distinct from the planner's own text request. */
export function taskCapabilities(
  project: Pick<
    Project,
    'provider' | 'workflow' | 'workMode' | 'executor' | 'researchEnabled' | 'deliveryMode'
  >,
) {
  const provider =
    hasProjectTools(project) && project.executor ? project.executor.provider : project.provider;
  const files =
    hasProjectTools(project) && (provider === 'codex' || project.workMode === 'container');
  return {
    text: true,
    fileInspection: files,
    fileEditing: files && project.deliveryMode !== 'design',
    commands: files,
    webResearch: provider === 'codex' && !!project.researchEnabled,
    externalActions: false,
  };
}

/** Explicit execution selection, never an error-triggered fallback. Planning
 * and meetings retain the project's primary connection. */
export function taskExecutionProject(project: Project): Project {
  return project.executor && hasProjectTools(project)
    ? { ...project, provider: 'codex', model: project.executor.model }
    : project;
}
