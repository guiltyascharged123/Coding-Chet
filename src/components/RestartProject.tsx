import { useState } from 'react';
import type { Project } from '../../shared/types';
import { api } from '../api';
import Modal from './Modal';
import { useSavedDraft } from '../drafts';

export default function RestartProject({
  project,
  onClose,
  onCreated,
}: {
  project: Project;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [draft, setDraft, clear, draftError] = useSavedDraft(`workroom-restart-${project.id}`, {
    requestId: crypto.randomUUID(),
    title: `${project.title.slice(0, 70)} · new run`,
    mode: project.provider === 'external' ? 'reuse' : 'replan',
    officeCapacity: project.officeCapacity || 4,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title="Restart project fresh"
      subtitle="Create a new run and keep the previous run for reference."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const { project: created } = await api<{ project: Project }>(
              `/projects/${project.id}/restart`,
              draft,
            );
            clear();
            onCreated(created.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          New run name
          <input
            aria-label="New run name"
            value={draft.title}
            maxLength={80}
            required
            minLength={2}
            onChange={(e) =>
              setDraft({ ...draft, title: e.target.value, requestId: crypto.randomUUID() })
            }
          />
        </label>
        <label>
          Office for new run
          <select
            aria-label="Office for new run"
            value={draft.officeCapacity}
            onChange={(e) => {
              const capacity = Number(e.target.value) as 4 | 8 | 12;
              setDraft({
                ...draft,
                officeCapacity: capacity,
                mode: capacity < (project.officeCapacity || 4) ? 'replan' : draft.mode,
                requestId: crypto.randomUUID(),
              });
            }}
          >
            {[4, 8, 12].map((capacity) => (
              <option
                key={capacity}
                value={capacity}
                disabled={
                  project.provider === 'external' && capacity < (project.officeCapacity || 4)
                }
              >
                {capacity}-agent office
              </option>
            ))}
          </select>
        </label>
        <label>
          Starting plan
          <select
            aria-label="Restart starting plan"
            value={draft.mode}
            onChange={(e) =>
              setDraft({ ...draft, mode: e.target.value, requestId: crypto.randomUUID() })
            }
          >
            <option value="replan" disabled={project.provider === 'external'}>
              Create a new model-generated plan
            </option>
            <option value="reuse" disabled={draft.officeCapacity < (project.officeCapacity || 4)}>
              Reuse the current assignments, with empty results
            </option>
          </select>
        </label>
        <p>
          Model:{' '}
          <strong>
            {project.provider} · {project.model || 'worker-managed'}
          </strong>
          . The new run keeps the brief, specialist team, approved team instructions and project
          settings. Earlier results, decisions, conversation and source files stay with the previous
          run.
        </p>
        <p>
          {draft.mode === 'replan'
            ? 'Creating the plan uses the selected model and its allowance.'
            : 'The copied tasks wait for you to run the team.'}{' '}
          Rolling workspace request and spending limits still apply.
        </p>
        {draftError && <p role="alert">{draftError}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? 'Stopping previous work and creating run…' : 'Create fresh run'}
        </button>
      </form>
    </Modal>
  );
}
