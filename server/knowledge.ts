import type { Project, WorkspaceState } from '../shared/types.js';
import type { SavedSource } from './context.js';

export const isDirection = (message: NonNullable<WorkspaceState['projectMessages']>[number]) =>
  message.kind === 'direction' || (!message.kind && !message.responseTaskId);

export function projectKnowledge(project: Project, state?: WorkspaceState) {
  const messages = (state?.projectMessages || []).filter(
    (message) => message.projectId === project.id,
  );
  const ideas = (state?.ideas || []).filter((idea) => idea.projectId === project.id);
  return {
    standingDirections: messages
      .filter((message) => isDirection(message) && message.active !== false)
      .map((message) => ({ sourceId: `message:${message.id}`, text: message.content })),
    selectedApproaches: ideas
      .filter((idea) => idea.status === 'selected')
      .map((idea) => ({ sourceId: `idea:${idea.id}`, title: idea.title, proposal: idea.proposal })),
    boardDecisions: [
      {
        sourceId: 'board-decisions',
        title:
          'Saved approach decisions and investigation findings — retrieve before repeating an experiment',
        text: ideas
          .filter(
            (idea) =>
              ['selected', 'rejected', 'evaluated'].includes(idea.status) || idea.evaluation,
          )
          .map(
            (idea) =>
              `${idea.status.toUpperCase()} | idea:${idea.id} | ${idea.title}\n${idea.proposal}\nReported evaluation (not independent verification): ${idea.evaluation || 'None.'}\nInvestigation source: ${idea.investigationTaskId ? `task:${idea.investigationTaskId}` : 'None.'}`,
          )
          .join('\n\n'),
      },
    ],
    archiveIndex: [
      {
        sourceId: 'project-archive',
        title: 'Project archive directory — older saved sources remain retrievable',
        text: [
          ...messages.map(
            (message) =>
              `message:${message.id} | ${message.active === false ? 'revoked/superseded' : message.kind || 'direction'} | ${message.content.slice(0, 100)}`,
          ),
          ...ideas.map((idea) => `idea:${idea.id} | ${idea.status} | ${idea.title}`),
          ...(state?.meetings || [])
            .filter((meeting) => meeting.projectId === project.id)
            .map((meeting) => `meeting:${meeting.id} | ${meeting.status} | ${meeting.agenda}`),
          ...(state?.tasks || [])
            .filter((task) => task.projectId === project.id)
            .map((task) => `task:${task.id} | ${task.status} | ${task.title}`),
        ].join('\n'),
      },
    ],
    knowledgeNotice:
      'Every active standing direction applies until explicitly revoked or superseded. Selected approaches are user choices, not evidence of success. Saved board decisions and the project archive may be excerpts; retrieve/search them when a missing source matters, especially before proposing a previously rejected route.',
  };
}

export function archivedSource(
  state: WorkspaceState | undefined,
  project: Project,
  id: string,
): SavedSource | undefined {
  if (!state) return;
  if (id.startsWith('calculation:')) {
    const receipt = state.tasks
      .filter((task) => task.projectId === project.id)
      .flatMap((task) => task.toolLog || [])
      .find((entry) => entry.type === 'calculator' && `calculation:${entry.id}` === id);
    if (receipt)
      return { id, label: `Exact arithmetic receipt (${receipt.status})`, text: receipt.detail };
    return;
  }
  const knowledge = projectKnowledge(project, state);
  const index = [...knowledge.boardDecisions, ...knowledge.archiveIndex].find(
    (source) => source.sourceId === id,
  );
  if (index) return { id, label: index.title, text: index.text };
  const message = state.projectMessages?.find(
    (message) => `message:${message.id}` === id && message.projectId === project.id,
  );
  if (message)
    return {
      id,
      label: `Project message (${message.active === false ? 'revoked/superseded, historical evidence only' : message.kind || 'direction'})`,
      text: message.content,
    };
  const idea = state.ideas?.find(
    (idea) => `idea:${idea.id}` === id && idea.projectId === project.id,
  );
  if (idea)
    return {
      id,
      label: `${idea.status} idea: ${idea.title}`,
      text: `Status: ${idea.status}. ${idea.proposal}\nRationale: ${idea.rationale}\nNext step: ${idea.nextStep}\nEvaluation: ${idea.evaluation || 'Not investigated.'}`,
    };
  const task = state.tasks.find(
    (task) => `task:${task.id}` === id && task.projectId === project.id,
  );
  if (task)
    return {
      id,
      label: `${task.title} (${task.status}; ${task.status === 'done' ? 'accepted' : 'not accepted'})`,
      text: JSON.stringify({
        assignment: {
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          briefRevision: task.briefRevision || 0,
        },
        result: task.result,
        output: task.output,
        unacceptedDraft: task.localArtifact?.text || undefined,
        unacceptedDraftNotice: task.localArtifact?.text
          ? 'Saved writing-stage artifact. Not accepted or independently verified; inspect its actual contents against the assignment.'
          : undefined,
        error: task.error,
      }),
    };
  const meeting = state.meetings?.find(
    (meeting) => `meeting:${meeting.id}` === id && meeting.projectId === project.id,
  );
  if (meeting)
    return {
      id,
      label: `${meeting.agenda} (${meeting.status})`,
      text: JSON.stringify({
        contributions: meeting.contributions,
        summary: meeting.summary,
        actions: meeting.actions,
        error: meeting.error,
      }),
    };
}
