import type { Bootstrap, Project } from '../../shared/types';
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSavedDraft } from '../drafts';
import { api } from '../api';
import { useHistory } from '../useHistory';
import type { WorkspaceState } from '../../shared/types';

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
  const history = useHistory<NonNullable<WorkspaceState['projectMessages']>[number]>(
    `/projects/${project.id}/messages`,
    (data.state.projectMessages || []).filter((message) => message.projectId === project.id),
  );
  const messages = history.entries;
  type Message = NonNullable<WorkspaceState['projectMessages']>[number];
  const [directions, setDirections] = useState<Message[]>([]);
  useEffect(() => {
    let current = true;
    api<{ entries: Message[] }>(`/projects/${project.id}/directions`, undefined, 'GET')
      .then((page) => {
        if (current) setDirections(page.entries);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [project.id]);
  const activeById = new Map(directions.map((message) => [message.id, message]));
  for (const message of data.state.projectMessages || [])
    if (
      message.projectId === project.id &&
      (message.kind === 'direction' || (!message.kind && !message.responseTaskId))
    ) {
      const prior = activeById.get(message.id);
      if (
        !prior ||
        (message.updatedAt || message.createdAt) >= (prior.updatedAt || prior.createdAt)
      )
        activeById.set(message.id, message);
    }
  const activeDirections = [...activeById.values()].filter((message) => message.active !== false);
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
        <details>
          <summary>Active standing directions · {activeDirections.length}</summary>
          {activeDirections.map((message) => (
            <article key={message.id}>
              <p>{message.content}</p>
              <button
                className="text-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(
                      `/projects/${project.id}/messages/${message.id}`,
                      { active: false },
                      'PATCH',
                    );
                    setDirections((prior) => prior.filter((item) => item.id !== message.id));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Revoke this standing direction
              </button>
            </article>
          ))}
        </details>
        {history.more && (
          <button className="button secondary" disabled={history.busy} onClick={history.loadOlder}>
            Load older messages
          </button>
        )}
        {history.error && <p role="alert">{history.error}</p>}
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
                {(message.kind === 'direction' || (!message.kind && !message.responseTaskId)) && (
                  <>
                    <small>
                      {message.active === false
                        ? 'Revoked direction · retained in history'
                        : 'Active standing direction'}
                    </small>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(
                            `/projects/${project.id}/messages/${message.id}`,
                            { active: message.active === false },
                            'PATCH',
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {message.active === false ? 'Reactivate direction' : 'Revoke direction'}
                    </button>
                  </>
                )}
                <p>{message.content}</p>
              </div>
              {task && (
                <div className="project-chat-reply">
                  <strong>
                    {agent?.name || 'Coordinator'} ·{' '}
                    {task.status === 'done' ? 'Reply' : task.status}
                  </strong>
                  {task.dependencies
                    .map((id) => data.state.tasks.find((child) => child.id === id))
                    .filter((child) => child && child.status !== 'done')
                    .map((child) => (
                      <p
                        key={child!.id}
                        className={child!.status === 'failed' ? 'form-error' : 'field-hint'}
                      >
                        Waiting for {child!.title} · {child!.status}
                        {child!.error ? `: ${child!.error}` : ''}{' '}
                        <button className="text-button" onClick={() => onTask(child!.id)}>
                          Open required teammate work
                        </button>
                      </p>
                    ))}
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
              {!task && (
                <small>
                  {message.kind === 'question'
                    ? 'Saved message · no reply requested'
                    : message.active === false
                      ? 'Historical direction · no longer applied'
                      : 'Saved direction · used by upcoming agent requests'}
                </small>
              )}
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
