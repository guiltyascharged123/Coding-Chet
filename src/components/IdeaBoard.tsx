import { useState } from 'react';
import type { Bootstrap, Project } from '../../shared/types';
import { useSavedDraft } from '../drafts';
import { api } from '../api';

export default function IdeaBoard({
  data,
  project,
  onTask,
  onMeeting,
}: {
  data: Bootstrap;
  project: Project;
  onTask: (id: string) => void;
  onMeeting: (id: string) => void;
}) {
  const [draft, save, clear, draftError] = useSavedDraft(`workroom-idea-${project.id}`, {
    id: crypto.randomUUID(),
    title: '',
    proposal: '',
    rationale: '',
    nextStep: '',
  });
  const [request, saveRequest] = useSavedDraft(`workroom-idea-request-${project.id}`, {
    id: crypto.randomUUID(),
    taskId: '',
  });
  const team = project.team || data.state.agents;
  const [owner, setOwner] = useState(team[0].id),
    [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const ideas = (data.state.ideas || []).filter((idea) => idea.projectId === project.id);
  async function act(fn: () => Promise<unknown>, text = '') {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage(text);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="idea-board" aria-label="Project idea board">
      <div className="section-header">
        <h2>Idea board · {ideas.length} saved proposals</h2>
        <button className="button secondary" onClick={() => setOpen(!open)}>
          {open ? 'Close idea form' : 'Add an idea'}
        </button>
      </div>
      <p>
        Proposals come from actual model results, team meetings or your input. Selecting an approach
        supplies it to upcoming requests; an investigation is a real assigned model job.
      </p>
      <div className="idea-board-tools">
        <label>
          Specialist for new investigations
          <select
            aria-label="Idea investigation specialist"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              saveRequest({ id: crypto.randomUUID(), taskId: '' });
            }}
          >
            {team.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} · {agent.role}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={busy || project.provider === 'external'}
          onClick={() =>
            act(async () => {
              const { message: saved } = await api<{ message: { responseTaskId: string } }>(
                `/projects/${project.id}/messages`,
                {
                  id: request.id,
                  askCoordinator: true,
                  kind: 'question',
                  respondAsAgentId: owner,
                  content:
                    'Propose up to three materially different approaches that could advance this project now. Assess real constraints, challenge weak assumptions, and return useful ideas with rationale and a bounded next step in the ideas field. Use the existing board to avoid duplicates. Do not invent demand, completed actions or evidence.',
                },
              );
              saveRequest({ id: crypto.randomUUID(), taskId: saved.responseTaskId });
            }, 'Proposal assignment queued. Its result will add useful proposals to this board.')
          }
        >
          Ask specialist for proposals
        </button>
        {request.taskId && (
          <button className="button secondary small" onClick={() => onTask(request.taskId)}>
            Open proposal assignment
          </button>
        )}
      </div>
      {open && (
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api(`/projects/${project.id}/ideas`, draft);
              clear();
              setOpen(false);
            }, 'Idea saved.');
          }}
        >
          <label>
            Idea title
            <input
              aria-label="Idea title"
              value={draft.title}
              required
              maxLength={100}
              onChange={(e) => save({ ...draft, title: e.target.value, id: crypto.randomUUID() })}
            />
          </label>
          {(
            [
              ['proposal', 'Proposal', 1200],
              ['rationale', 'Rationale and evidence gaps', 600],
              ['nextStep', 'Useful next step', 400],
            ] as const
          ).map(([key, label, limit]) => (
            <label key={key}>
              {label}
              <textarea
                aria-label={label}
                value={draft[key]}
                required
                maxLength={limit}
                rows={3}
                onChange={(e) => save({ ...draft, [key]: e.target.value, id: crypto.randomUUID() })}
              />
            </label>
          ))}
          {draftError && <p role="alert">{draftError}</p>}
          <button className="button primary" disabled={busy}>
            Save idea
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {!ideas.length && (
        <p className="idea-board-empty">
          No saved proposals yet. Add your idea, ask a specialist, or run a team meeting.
        </p>
      )}
      <div className="idea-card-grid">
        {ideas.map((idea) => {
          const task = data.state.tasks.find((task) => task.id === idea.investigationTaskId);
          return (
            <article
              className={`idea-card ${idea.status}`}
              key={idea.id}
              aria-label={`Idea: ${idea.title}`}
            >
              <span className="tag">{idea.status}</span>
              <h3>{idea.title}</h3>
              <small>
                {idea.authorName} · {idea.authorRole}
              </small>
              <p>{idea.proposal}</p>
              <p>
                <strong>Why / evidence:</strong> {idea.rationale}
              </p>
              <p>
                <strong>Next step:</strong> {idea.nextStep}
              </p>
              {idea.evaluation && <p className="idea-evaluation">Evaluation: {idea.evaluation}</p>}
              {task && (
                <p>
                  Investigation: {task.status}
                  {task.error ? ` · ${task.error}` : ''}
                </p>
              )}
              <div className="idea-card-actions">
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    act(() =>
                      api(
                        `/projects/${project.id}/ideas/${idea.id}`,
                        { status: idea.status === 'selected' ? 'proposed' : 'selected' },
                        'PATCH',
                      ),
                    )
                  }
                >
                  {idea.status === 'selected' ? 'Unselect approach' : 'Select approach'}
                </button>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    act(() =>
                      api(
                        `/projects/${project.id}/ideas/${idea.id}`,
                        { status: idea.status === 'rejected' ? 'proposed' : 'rejected' },
                        'PATCH',
                      ),
                    )
                  }
                >
                  {idea.status === 'rejected' ? 'Reopen idea' : 'Reject idea'}
                </button>
                {task ? (
                  <button className="button secondary small" onClick={() => onTask(task.id)}>
                    Open investigation
                  </button>
                ) : (
                  <button
                    className="button secondary small"
                    disabled={busy || project.provider === 'external'}
                    onClick={() =>
                      act(async () => {
                        await api(`/projects/${project.id}/ideas/${idea.id}/investigate`, {
                          requestId: crypto.randomUUID(),
                          agentId: owner,
                        });
                      })
                    }
                  >
                    Investigate · uses model
                  </button>
                )}
                {idea.sourceTaskId && (
                  <button
                    className="button secondary small"
                    onClick={() => onTask(idea.sourceTaskId!)}
                  >
                    Source task
                  </button>
                )}
                {idea.sourceMeetingId && (
                  <button
                    className="button secondary small"
                    onClick={() => onMeeting(idea.sourceMeetingId!)}
                  >
                    Source meeting
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
