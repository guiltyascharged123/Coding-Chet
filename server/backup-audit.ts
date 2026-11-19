import { backupSchema } from '../shared/schemas.js';
import { hasProjectTools, taskCapabilities } from '../shared/capabilities.js';

/** Inspect an export without opening a Store, restoring it, running project
 * instructions, or including briefs/model replies in the diagnostic report. */
export function auditBackup(input: unknown) {
  const backup = backupSchema.parse(input);
  return {
    format: 'workroom-execution-audit',
    version: 1,
    recordedAttempts: backup.attempts.length,
    savedResponses: backup.attemptResults?.length || 0,
    simulationProjects: backup.state.projects.filter((p) => p.provider === 'demo').length,
    readiness: 'Not checked: a backup cannot establish current model, worker or sandbox readiness.',
    projects: backup.state.projects
      .filter((p) => p.provider !== 'demo')
      .map((project) => {
        const tasks = backup.state.tasks.filter((t) => t.projectId === project.id);
        const capabilities = taskCapabilities(project);
        const failures = tasks.filter((t) => t.status === 'failed');
        const retainedFailedWork = failures.filter(
          (t) => t.output || t.localArtifact?.text || t.result,
        ).length;
        const serviceRejections = failures.filter((t) =>
          /HTTP\s+403\b/i.test(t.error || ''),
        ).length;
        const timeouts = failures.filter((t) => /timeout|timed out/i.test(t.error || '')).length;
        const observedTools = tasks.reduce((n, t) => n + (t.toolLog?.length || 0), 0);
        return {
          projectId: project.id,
          provider: project.provider,
          model: project.model,
          executor: project.executor,
          mode:
            project.workMode === 'container'
              ? 'container'
              : hasProjectTools(project)
                ? 'workspace'
                : 'text',
          configuredCapabilities: capabilities,
          tasks: {
            total: tasks.length,
            done: tasks.filter((t) => t.status === 'done').length,
            failed: failures.length,
            queued: tasks.filter((t) => t.status === 'queued').length,
            retainedFailedWork,
          },
          recordedToolEvents: observedTools,
          issues: [
            ...(!capabilities.commands && project.provider !== 'external'
              ? [
                  'TEXT_ONLY: this selection cannot build or execute tools. Role instructions do not grant execution.',
                ]
              : []),
            ...(project.provider === 'external'
              ? [
                  'EXTERNAL_WORKER: inspect the actual worker implementation; this export cannot establish its tools.',
                ]
              : []),
            ...(serviceRejections
              ? [
                  `SERVICE_ACCESS: ${serviceRejections} failed task(s) recorded HTTP 403; check the selected service, model access, key and quota.`,
                ]
              : []),
            ...(timeouts ? [`TIMEOUT: ${timeouts} failed task(s) recorded a timeout.`] : []),
            ...(retainedFailedWork
              ? [
                  `RETAINED_WORK: ${retainedFailedWork} failed task(s) still contain saved work; a failed retry does not mean the prior work was lost or newly accepted.`,
                ]
              : []),
            ...(tasks.length && !observedTools
              ? [
                  'NO_TOOL_EVENTS: no task tool events were recorded. This is not evidence of external execution.',
                ]
              : []),
          ],
          outcome: 'Task completion alone does not establish that the project goal was achieved.',
        };
      }),
  };
}
