import type { Bootstrap, Project } from '../../shared/types';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSavedDraft } from '../drafts';
import { api } from '../api';

export default function ProjectConversation({
  data,
  project,
  onTask,
}: {
  data: Bootstrap;
  project: Project;
  onTask: (id: string) => void;
}) {
  const [draft, save, clear, draftError] = useSavedDraft(`workroom-chat-${project.id}`, {
    id: crypto.randomUUID(),
    content: '',
    askCoordinator: project.provider !== 'external',
    kind: (project.provider === 'external' ? 'direction' : 'question') as 'direction' | 'question',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const messages = (data.state.projectMessages || []).filter((m) => m.projectId === project.id);
  return (
    <section className="project-conversation" aria-label="Project conversation">
      <div className="section-header">
        <h2>Project conversation</h2>
        <span>
          {project.provider} · {project.model || 'worker model'}
        </span>
      </div>
      <p>
        Your messages stay with this project. Agents receive recent direction and relevant saved
        work with their own role instructions on each request.
      </p>
      <div className="project-chat-log" role="log" aria-label="Saved project conversation">
        {!messages.length && (
          <p>No messages yet. Ask the coordinator a question or save direction for the team.</p>
        )}
        {messages.map((message) => {
          const task = data.state.tasks.find((t) => t.id === message.responseTaskId);
          const agent = (project.team || data.state.agents).find((a) => a.id === task?.agentId);
          return (
            <article className="project-chat-turn" key={message.id}>
              <div>
                <strong>You</strong>
                <p>{message.content}</p>
              </div>
              {task && (
                <div className="project-chat-reply">
                  <strong>
                    {agent?.name || 'Coordinator'} ·{' '}
                    {task.status === 'done' ? 'Reply' : task.status}
                  </strong>
                  {task.output ? (
                    <ReactMarkdown>{task.output}</ReactMarkdown>
                  ) : (
                    <p>
                      {task.status === 'queued'
                        ? 'Reply queued within workspace limits.'
                        : task.status === 'working'
                          ? 'Model request active. Public streaming output is available in this task’s console.'
                          : task.error || 'Open the task to review its saved state.'}
                    </p>
                  )}
                  <button className="button secondary small" onClick={() => onTask(task.id)}>
                    Open response task & live output
                  </button>
                  {task.status === 'working' && (
                    <button
                      className="button secondary small"
                      onClick={async () => {
                        try {
                          await api(`/projects/${project.id}/pause`);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Pause project work
                    </button>
                  )}
                </div>
              )}
              {!task && <small>Saved direction · used by upcoming agent requests</small>}
            </article>
          );
        })}
      </div>
      <form
        className="modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(`/projects/${project.id}/messages`, {
              ...draft,
              kind: draft.kind || (draft.askCoordinator ? 'question' : 'direction'),
            });
            clear();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Message your project team
          <textarea
            aria-label="Message your project team"
            rows={4}
            required
            maxLength={2000}
            value={draft.content}
            onChange={(e) => save({ ...draft, content: e.target.value, id: crypto.randomUUID() })}
          />
        </label>
        <label>
          Message intent
          <select
            aria-label="Message intent"
            value={draft.kind || (draft.askCoordinator ? 'question' : 'direction')}
            onChange={(e) =>
              save({
                ...draft,
                kind: e.target.value as 'question' | 'direction',
                id: crypto.randomUUID(),
              })
            }
          >
            <option value="question">Question for the coordinator</option>
            <option value="direction">Standing direction for the team</option>
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.askCoordinator}
            disabled={project.provider === 'external'}
            onChange={(e) =>
              save({ ...draft, askCoordinator: e.target.checked, id: crypto.randomUUID() })
            }
          />
          Request a coordinator reply (uses model allowance)
        </label>
        <p className="field-hint">
          A reply is a saved assignment within existing limits. It can run while the main plan is
          paused, without resuming unrelated tasks. Save direction alone makes no model request.
        </p>
        {draftError && <p role="alert">{draftError}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy
            ? 'Saving…'
            : draft.askCoordinator
              ? 'Send to coordinator'
              : 'Save project direction'}
        </button>
      </form>
    </section>
  );
}
