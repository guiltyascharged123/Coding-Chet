import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Meeting, Project } from '../../shared/types';
import { api } from '../api';
import { useSavedDraft } from '../drafts';
import DocumentActions from './DocumentActions';

export default function Collaboration({
  project,
  meetings,
  onSettings,
  onUsage,
}: {
  project: Project;
  meetings: Meeting[];
  onSettings: () => void;
  onUsage: () => void;
}) {
  const [agenda, setAgenda, clearAgenda, draftError] = useSavedDraft(
    `workroom-agenda-${project.id}`,
    'Compare approaches to the project goal, challenge weak assumptions, and agree the next useful actions.',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
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
          : 'A normal meeting uses five model requests; malformed replies can add one correction per turn. Existing limits apply. Contributions are generated one at a time.'}{' '}
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
            busy || !!active || project.provider === 'external' || agenda.trim().length < 10
          }
          onClick={() =>
            act(async () => {
              await api(`/projects/${project.id}/meetings`, { agenda });
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
        <article className="meeting-record" key={meeting.id}>
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
