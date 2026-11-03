import type { Bootstrap, Meeting, Task } from '../shared/types';
import type { ConsoleEntry, ModelProgress } from '../shared/console';

type Purpose = NonNullable<ModelProgress['purpose']>;
export type ModelJob = {
  id: string;
  actor: string;
  role: string;
  assignment: string;
  phase: 'plan' | 'task' | 'meeting';
  taskId?: string;
  agentId?: string;
  startedAt: number;
  requestAt?: number;
  lastUpdate?: number;
  provider: string;
  model?: string;
  active: boolean;
  label: string;
  detail: string;
  purpose: Purpose;
  metrics?: ModelProgress;
  characters?: number;
  inputTokens?: number;
  outputTokens?: number;
  attemptId?: string;
};

/** Observe saved lifecycle and public events; never infer private reasoning or invented progress. */
export function modelJobs(data: Bootstrap, projectId: string, entries: ConsoleEntry[]): ModelJob[] {
  const project = data.state.projects.find((project) => project.id === projectId);
  if (!project) return [];
  const team = project.team || data.state.agents;
  const tasks = data.state.tasks.filter((task) => task.projectId === project.id);
  const meetings = (data.state.meetings || []).filter(
    (meeting) => meeting.projectId === project.id,
  );
  const history = entries
    .filter((entry) => entry.projectId === project.id)
    .sort((a, b) => a.sequence - b.sequence);
  const scopes: { phase: ModelJob['phase']; task?: Task; meeting?: Meeting; active: boolean }[] =
    [];
  if (project.planningStatus === 'planning') scopes.push({ phase: 'plan', active: true });
  for (const task of tasks.filter((task) => task.status === 'working'))
    scopes.push({ phase: 'task', task, active: true });
  for (const meeting of meetings.filter((meeting) =>
    ['gathering', 'running'].includes(meeting.status),
  ))
    scopes.push({ phase: 'meeting', meeting, active: true });
  if (!scopes.length) {
    const queued = tasks.find(
      (task) =>
        task.status === 'queued' &&
        (['running', 'needs_input'].includes(project.status) || task.conversationPending),
    );
    if (queued) scopes.push({ phase: 'task', task: queued, active: false });
  }
  if (!scopes.length) {
    const last = history.at(-1);
    if (last)
      scopes.push({
        phase: last.phase,
        task: tasks.find((task) => task.id === last.taskId),
        meeting: meetings.find((meeting) => meeting.id === last.meetingId),
        active: false,
      });
  }
  return scopes.map(({ phase, task, meeting, active }) => {
    const startedAt =
      phase === 'plan'
        ? project.planningStartedAt || project.createdAt
        : task
          ? task.lastAttemptStartedAt || task.startedAt || project.createdAt
          : meeting?.startedAt || meeting?.createdAt || project.createdAt;
    const current = history.filter(
      (entry) =>
        entry.phase === phase &&
        entry.updatedAt >= startedAt &&
        (task
          ? entry.taskId === task.id
          : meeting
            ? entry.meetingId === meeting.id
            : !entry.taskId),
    );
    const last = current.at(-1);
    const receipts = (data.attempts || []).filter(
      (attempt) =>
        attempt.projectId === project.id &&
        attempt.phase === phase &&
        attempt.createdAt >= startedAt &&
        (task ? attempt.taskId === task.id : meeting ? attempt.meetingId === meeting.id : true),
    );
    const running = receipts
      .filter((attempt) => attempt.status === 'running')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const request = [...current]
      .reverse()
      .find((entry) => entry.type === 'request' && (!running || entry.attemptId === running.id));
    const receipt = running || receipts.find((attempt) => attempt.id === request?.attemptId);
    const response = [...current]
      .reverse()
      .find(
        (entry) =>
          entry.type === 'response' &&
          (!request?.attemptId || entry.attemptId === request.attemptId),
      );
    const actorId =
      task?.agentId || meeting?.speakerId || (phase === 'plan' ? team[0]?.id : last?.agentId);
    const actor = team.find((agent) => agent.id === actorId);
    let label = 'Preparing request',
      detail = 'Assembling role instructions, the assignment and selected saved evidence.';
    const purpose = request?.progress?.purpose || last?.progress?.purpose || 'initial';
    if (!active && task?.status === 'queued') {
      const dependencies = tasks.filter(
        (other) => task.dependencies.includes(other.id) && other.status !== 'done',
      );
      const occupied =
        data.state.tasks.filter((other) => other.status === 'working').length +
        data.state.projects.filter((other) => other.planningStatus === 'planning').length +
        (data.state.meetings || []).filter((other) =>
          ['gathering', 'running'].includes(other.status),
        ).length;
      const capacity = data.state.policy?.maxConcurrent || 1;
      label = dependencies.length
        ? 'Waiting for required teammate work'
        : occupied >= capacity
          ? 'Waiting for workspace capacity'
          : 'Queued for dispatch';
      detail = dependencies.length
        ? dependencies.map((other) => `${other.title} (${other.status})`).join('; ')
        : occupied >= capacity
          ? `${occupied} of ${capacity} workspace slots are occupied. No model request has been sent for this queued assignment.`
          : 'This assignment is queued; no model request is running for it yet.';
    } else if (!active) {
      label =
        phase === 'plan'
          ? project.planningStatus === 'failed'
            ? 'Plan needs attention'
            : 'Plan saved'
          : meeting
            ? meeting.status === 'completed'
              ? 'Meeting record saved'
              : 'Meeting needs attention'
            : task?.status === 'done'
              ? 'Work saved'
              : task?.status === 'review'
                ? 'Waiting for your decision'
                : task?.status === 'failed'
                  ? 'Work needs attention'
                  : 'No model request running';
      detail =
        phase === 'plan'
          ? project.planningError || 'A completed request and an accepted plan are separate checks.'
          : task?.error || meeting?.error || 'No model request is running for this saved record.';
    } else if (meeting?.status === 'gathering') {
      label = 'Gathering meeting participants';
      detail = 'The team is gathering. No contribution is being requested yet.';
    } else if (last?.type === 'error') {
      label = 'Checking a rejected response';
      detail = last.text.slice(0, 350);
    } else if (last?.status === 'correction') {
      label = 'Requesting a format correction';
      detail = last.text.slice(0, 350);
    } else if (last?.status === 'retrieval') {
      label = 'Retrieving saved evidence';
      detail = last.text.slice(0, 350);
    } else if (last?.type === 'command' || last?.type === 'tool') {
      label =
        last.status === 'failed'
          ? 'Tool reported a failure'
          : last.status === 'in_progress'
            ? 'Running a tool'
            : 'Tool result received';
      detail = last.text.split('\n')[0].slice(0, 240);
    } else if (
      last?.progress?.stage === 'streaming' ||
      (last?.type === 'response' && last.status === 'in_progress')
    ) {
      label = 'Receiving public reply';
      detail = 'Public output is arriving from the model. Open the live console to read it.';
    } else if (
      last?.progress?.stage === 'validating' ||
      last?.type === 'response' ||
      last?.status === 'completed'
    ) {
      label = 'Checking the model reply';
      detail =
        'The request returned. Workroom is checking its structure, assignments and required evidence before accepting it.';
    } else if (
      last?.progress?.stage === 'waiting' ||
      last?.type === 'request' ||
      receipt?.status === 'running'
    ) {
      label =
        last?.status === 'processing'
          ? 'Provider reported activity'
          : 'Waiting for public model output';
      detail =
        project.provider === 'ollama'
          ? 'The request was sent to Ollama. No public reply has arrived yet. Loading the model and processing a long prompt can take minutes on a CPU. No more detailed provider progress is available yet.'
          : 'The request has been sent. The provider has not supplied a public reply yet; some providers return text only at completion.';
    }
    if (project.provider === 'external' && active) {
      label = 'External worker has the assignment';
      detail =
        'Workroom sees the lease and submitted events. It cannot confirm the worker’s internal model activity; open the console for reported updates.';
    }
    if (project.provider === 'demo') {
      label = 'Saved simulation';
      detail = 'No real model was called.';
    }
    const latestProgress = [...current]
      .reverse()
      .find(
        (entry) =>
          entry.progress?.receivedCharacters !== undefined &&
          (!request?.attemptId || entry.attemptId === request.attemptId),
      );
    return {
      id: task?.id || meeting?.id || `plan:${project.id}`,
      actor: actor?.name || (phase === 'plan' ? 'Planner' : 'Team'),
      role: actor?.role || (phase === 'meeting' ? 'Team discussion' : 'Coordinator'),
      assignment: task?.title || meeting?.agenda || 'Create project task plan',
      phase,
      taskId: task?.id,
      agentId: actorId,
      startedAt,
      requestAt: task?.status === 'queued' ? undefined : receipt?.createdAt || request?.createdAt,
      lastUpdate: last?.updatedAt,
      provider: request?.provider || project.provider,
      model: request?.model || project.model,
      active,
      label,
      detail,
      purpose,
      metrics: task?.status === 'queued' ? undefined : request?.progress,
      characters:
        task?.status === 'queued'
          ? undefined
          : (latestProgress?.progress?.receivedCharacters ?? response?.text.length),
      inputTokens: receipt?.inputTokens,
      outputTokens: receipt?.outputTokens,
      attemptId: receipt?.id || request?.attemptId,
    };
  });
}
