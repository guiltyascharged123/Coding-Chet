import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Meeting, Project, Task } from '../../shared/types';
import { api } from '../api';
import { useSavedDraft } from '../drafts';
import DocumentActions from './DocumentActions';

export default function Collaboration({
  project,
  meetings,
  tasks,
  onTask,
  onSettings,
  onUsage,
  focusId,
}: {
  project: Project;
  meetings: Meeting[];
  tasks: Task[];
  onTask: (id: string) => void;
  onSettings: () => void;
  onUsage: () => void;
  focusId?: string;
}) {
  useEffect(() => {
    if (focusId) document.getElementById(`meeting-${focusId}`)?.scrollIntoView({ block: 'start' });
  }, [focusId]);
  const [agenda, setAgenda, clearAgenda, draftError] = useSavedDraft(
    `workroom-agenda-${project.id}`,
    'Compare approaches to the project goal, challenge weak assumptions, and agree the next useful actions.',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [participants, setParticipants] = useState(() =>
    (project.team || []).map((agent) => agent.id),
  );
  const selectedParticipants = participants.filter((id) =>
    project.team?.some((agent) => agent.id === id),
  );
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = meetings.find((m) => m.status === 'running' || m.status === 'gathering');
  return (
    <section className="collaboration-panel">
      <div className="section-header">
        <h2>Team discussions</h2>
        <button className="button secondary small" onClick={onSettings}>
          Meeting & reasoning settings
        </button>
      </div>
      <p>
        Read proposals, critiques and decisions as the team works. Saved decision records guide
        upcoming assignments.
      </p>
      <p className="field-hint">
        {project.provider === 'demo'
          ? 'Demo meetings are labeled simulations; no AI is called.'
          : `A meeting uses one model request per selected participant, plus one for the chair; malformed replies use the format-correction allowance in Workspace controls. Existing limits apply. Contributions are generated one at a time.`}{' '}
        Automatic meetings:{' '}
        {project.meetingPolicy?.enabled
          ? `kickoff and after every ${project.meetingPolicy.everyTasks} completed tasks`
          : 'off'}
        .{' '}
        {project.provider === 'codex' && (
          <>Codex reasoning: {project.reasoningEffort || 'medium'}.</>
        )}
      </p>
      <details className="meeting-agenda-editor" open={!meetings.length}>
        <summary>{meetings.length ? 'Start another meeting' : 'Meeting agenda'}</summary>
        <fieldset>
          <legend>Meeting participants</legend>
          {(project.team || []).map((agent) => (
            <label key={agent.id} className="checkbox-label">
              <input
                type="checkbox"
                checked={selectedParticipants.includes(agent.id)}
                onChange={(e) =>
                  setParticipants((previous) =>
                    e.target.checked
                      ? [...previous, agent.id]
                      : previous.filter((id) => id !== agent.id),
                  )
                }
              />
              {agent.name} · {agent.role}
            </label>
          ))}
          <p className="field-hint">
            {selectedParticipants.length} participants · normally {selectedParticipants.length + 1}{' '}
            requests. The first selected teammate chairs. Automatic meetings include the full team.
          </p>
        </fieldset>
        <label>
          Meeting agenda
          <textarea
            aria-label="Meeting agenda"
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            maxLength={3000}
            rows={3}
          />
        </label>
        {project.provider === 'external' && (
          <p className="field-hint">
            Built-in meetings need a direct model connection. External workers retain their existing
            task protocol.
          </p>
        )}
        <p className="field-hint">{draftError || 'Agenda draft saved in this browser.'}</p>
        <button
          className="button primary"
          disabled={
            busy ||
            !!active ||
            project.provider === 'external' ||
            agenda.trim().length < 10 ||
            !selectedParticipants.length
          }
          onClick={() =>
            act(async () => {
              await api(`/projects/${project.id}/meetings`, {
                agenda,
                participants: selectedParticipants,
              });
              clearAgenda();
            })
          }
        >
          Start team meeting
        </button>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!meetings.length && (
        <div className="empty-state">
          <h3>No discussions yet</h3>
          <p>
            Start a meeting, or enable automatic meetings before running the team. Each participant
            contributes from its role; the meeting record guides later work.
          </p>
        </div>
      )}
      {[...meetings].reverse().map((meeting) => (
        <article id={`meeting-${meeting.id}`} className="meeting-record" key={meeting.id}>
          <header>
            <div>
              <span className="eyebrow">
                {meeting.trigger} · {meeting.status} ·{' '}
                {project.provider === 'demo' ? 'demo' : 'model discussion'}
              </span>
              <h3>{meeting.agenda}</h3>
              <span>
                {new Date(meeting.createdAt).toLocaleString()} · {meeting.checkpoint} tasks
                completed at start
              </span>
            </div>
            {['gathering', 'running'].includes(meeting.status) && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => act(() => api(`/meetings/${meeting.id}/stop`))}
              >
                Stop meeting
              </button>
            )}
          </header>
          {meeting.speakerId && (
            <p role="status">
              {meeting.status === 'gathering'
                ? 'Team gathering'
                : meeting.contributions.length === meeting.participants.length
                  ? 'The chair is preparing decisions and next actions'
                  : `${meeting.participants.find((a) => a.id === meeting.speakerId)?.name} is preparing a contribution`}
              . Completed contributions appear below.
            </p>
          )}
          {meeting.summary && (
            <section className="meeting-decision">
              <div className="section-header">
                <h3>Decisions, objections & next actions</h3>
                <DocumentActions title={`${project.title}-meeting`} content={meeting.summary} />
              </div>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{meeting.summary}</ReactMarkdown>
              </div>
            </section>
          )}
          {!!meeting.actions?.length && (
            <section className="meeting-actions">
              <h3>Tracked actions</h3>
              {meeting.actions.map((action) => {
                const task = tasks.find((task) => task.id === action.taskId);
                const owner = project.team?.find((agent) => agent.id === action.agentId);
                return (
                  <div className="meeting-action" key={action.id}>
                    <strong>
                      {action.status === 'addressed'
                        ? 'Reported check met'
                        : action.status === 'assigned'
                          ? 'Assigned check'
                          : 'Proposed · not assigned'}
                      {owner ? ` · ${owner.name}` : ''}
                    </strong>
                    <p>{action.action}</p>
                    {action.evidence && <p>Saved evidence: {action.evidence}</p>}
                    {task && (
                      <button className="button secondary small" onClick={() => onTask(task.id)}>
                        Open assignment: {task.title}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {meeting.contributions.map((c, i) => (
            <section className="meeting-contribution" key={c.agentId}>
              <h4>
                <span
                  style={{
                    backgroundColor: meeting.participants.find((a) => a.id === c.agentId)?.color,
                  }}
                />
                {i + 1}. {meeting.participants.find((a) => a.id === c.agentId)?.name} · {c.role}
              </h4>
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.content}</ReactMarkdown>
              </div>
            </section>
          ))}
          {meeting.responseIssue && (
            <details>
              <summary>Rejected meeting reply · saved validation details</summary>
              <ul>
                {meeting.responseIssue.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
              <pre className="rejected-meeting-reply">{meeting.responseIssue.response}</pre>
            </details>
          )}
          {meeting.error && (
            <p className="form-error" role="alert">
              {meeting.error}
            </p>
          )}
          {meeting.status === 'failed' && (
            <div className="file-actions">
              <button className="button secondary" onClick={onUsage}>
                Review meeting usage
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => act(() => api(`/meetings/${meeting.id}/retry`))}
              >
                Retry remaining contributions
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => act(() => api(`/meetings/${meeting.id}/skip`))}
              >
                Skip meeting · retain record
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
