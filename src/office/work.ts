import type { Agent, Meeting, Project, Task } from '../../shared/types';
import type { ConsoleEntry } from '../../shared/console';

export type OfficeWork = {
  label: string;
  detail: string;
  active: boolean;
  animation: 'typing' | 'reading' | 'none';
  task?: Task;
  entry?: ConsoleEntry;
};

const providers: Record<string, string> = {
  codex: 'Codex',
  ollama: 'Ollama',
  compatible: 'model',
  openai: 'OpenAI',
  gemini: 'Gemini',
  external: 'worker',
  demo: 'demo',
};
function excerpt(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** Observable work only: no made-up progress, elapsed-time milestones or private reasoning. */
export function officeWork(
  agent: Agent,
  project: Project,
  tasks: Task[],
  entries: ConsoleEntry[],
  meeting?: Meeting,
): OfficeWork {
  tasks = tasks.filter((t) => t.projectId === project.id);
  const task =
    tasks.find((t) => t.agentId === agent.id && t.status === 'working') ||
    tasks.find((t) => t.agentId === agent.id && t.status === 'review');
  const liveMeeting =
    meeting &&
    meeting.participants.some((person) => person.id === agent.id) &&
    ['gathering', 'running'].includes(meeting.status)
      ? meeting
      : undefined;
  const planning =
    project.planningStatus === 'planning' &&
    (project.team ? agent.id === project.team[0]?.id : agent.desk === 0);
  const base = { active: false, animation: 'none' as const, task };
  if (liveMeeting && liveMeeting.speakerId !== agent.id)
    return {
      ...base,
      label: liveMeeting.speakerId ? 'Listening to teammate' : 'Joining meeting',
      detail: liveMeeting.agenda,
    };
  if (!liveMeeting && task?.status === 'review')
    return { ...base, label: 'Waiting for your decision', detail: task.title };
  const active = !!liveMeeting || task?.status === 'working' || planning;
  if (!active) {
    const assigned = tasks.filter((t) => t.agentId === agent.id);
    const failed = assigned.find((t) => t.status === 'failed');
    if (failed)
      return {
        ...base,
        task: failed,
        label: 'Needs attention',
        detail: failed.error || failed.title,
      };
    const queued = assigned.find((t) => t.status === 'queued');
    if (queued) {
      const dependencies = tasks.filter(
        (t) => queued.dependencies.includes(t.id) && t.status !== 'done',
      );
      const names = [
        ...new Set(
          dependencies
            .map((t) => project.team?.find((a) => a.id === t.agentId)?.name)
            .filter(Boolean),
        ),
      ];
      return {
        ...base,
        task: queued,
        label: dependencies.length ? `Waiting for ${names.join(', ') || 'dependencies'}` : 'Queued',
        detail: queued.title,
      };
    }
    const done = assigned.filter((t) => t.status === 'done').at(-1);
    return {
      ...base,
      task: done,
      label: done ? 'Finished assigned work' : 'Available',
      detail: done?.title || agent.role,
    };
  }
  const current = entries
    .filter(
      (e) =>
        e.projectId === project.id &&
        (liveMeeting
          ? e.meetingId === liveMeeting.id && e.agentId === agent.id
          : planning
            ? e.phase === 'plan' && e.createdAt >= project.createdAt
            : e.taskId === task!.id &&
              e.createdAt >= (task!.startedAt || 0) &&
              (!task!.attemptId || e.attemptId === task!.attemptId)),
    )
    .sort((a, b) => b.sequence - a.sequence);
  const entry = current[0];
  const detail = liveMeeting?.agenda || task?.title || 'Creating the project task plan';
  const result: OfficeWork = {
    active: true,
    animation: 'reading',
    task,
    entry,
    label: `Preparing ${planning ? 'plan' : liveMeeting ? 'contribution' : 'assignment'}`,
    detail,
  };
  if (!entry) return result;
  const model =
    providers[entry.provider as keyof typeof providers] ||
    providers[project.executor?.provider || project.provider] ||
    'model';
  if (entry.progress?.stage === 'preparing')
    return {
      ...result,
      label: 'Preparing model request',
      detail: 'Selecting the saved brief, role instructions and supporting evidence.',
    };
  if (entry.progress?.stage === 'waiting')
    return {
      ...result,
      label:
        entry.progress.purpose === 'correction'
          ? 'Waiting for corrected reply'
          : entry.progress.purpose === 'retrieval'
            ? 'Waiting after source retrieval'
            : 'Waiting for model reply',
      detail: 'The request is in flight; no public reply has arrived yet.',
    };
  if (entry.progress?.stage === 'validating')
    return {
      ...result,
      label: 'Checking model reply',
      detail: 'A response arrived; its work has not yet been accepted.',
    };

  if (entry.type === 'command')
    return {
      ...result,
      animation: entry.status === 'in_progress' ? 'typing' : 'reading',
      label:
        entry.status === 'in_progress'
          ? 'Running command'
          : entry.status === 'failed'
            ? 'Command failed'
            : 'Command finished',
      detail: excerpt(entry.text.split('\n')[0]),
    };
  if (entry.type === 'tool')
    return {
      ...result,
      animation: 'typing',
      label: entry.text.startsWith('Web search:') ? 'Searching the web' : 'Working with files',
      detail: excerpt(entry.text),
    };
  if (entry.type === 'response') {
    let text = entry.text;
    try {
      const value = JSON.parse(text);
      text =
        [value?.summary, value?.proposal, value?.decision, value?.deliverable].find(
          (field) => typeof field === 'string' && field.trim(),
        ) ||
        (value?.outcome === 'retrieve'
          ? 'The model requested saved source passages; its work is not complete.'
          : Array.isArray(value?.tasks)
            ? `Received ${value.tasks.length} proposed assignments; checking the plan.`
            : 'Structured reply received; checking its work result.');
    } catch {
      if (/^\s*\{/.test(text)) {
        const summary = text.match(/"summary"\s*:\s*("(?:\\.|[^"\\])*")/);
        try {
          text = summary
            ? JSON.parse(summary[1])
            : 'Receiving a structured reply; its work result has not been checked yet.';
        } catch {
          text = 'Receiving a structured reply; its work result has not been checked yet.';
        }
      }
    }
    return {
      ...result,
      animation: 'typing',
      label: entry.status === 'in_progress' ? 'Receiving reply' : 'Reply received',
      detail: excerpt(text),
    };
  }
  if (entry.status === 'correction' || entry.status === 'validation_failed')
    return { ...result, label: 'Correcting response format', detail: excerpt(entry.text) };
  if (entry.status === 'retrieval')
    return { ...result, label: 'Reading saved evidence', detail: excerpt(entry.text) };
  if (entry.type === 'error')
    return { ...result, label: 'Request needs attention', detail: excerpt(entry.text) };
  if (entry.type === 'request' || entry.status === 'processing')
    return { ...result, label: `${model} processing`, detail };
  return { ...result, detail: excerpt(entry.text) };
}
