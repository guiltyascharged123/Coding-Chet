import { useState, type FormEvent } from 'react';
import type { Project } from '../../shared/types';
import { WORKFLOWS } from '../../shared/workflows';
import { useSavedDraft } from '../drafts';
import { api, download } from '../api';
import Modal from './Modal';

export default function EditProjectModal({
  project,
  onClose,
  onSaved,
  onPlan,
  onConnection,
  onTeam,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
  onPlan: () => void;
  onConnection: () => void;
  onTeam: () => void;
}) {
  const [draft, setDraft, clearDraft, draftError] = useSavedDraft(
    `workroom-project-edit-${project.id}`,
    {
      title: project.title,
      brief: project.brief,
      reason: '',
      expectedUpdatedAt: project.updatedAt ?? project.createdAt,
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${project.id}`, draft, 'PUT');
      clearDraft();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Edit project"
      subtitle="Update the goal while retaining previous briefs, tasks, outputs and model choices."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={save}>
        <label>
          Project name
          <input
            aria-label="Project name"
            required
            minLength={2}
            maxLength={80}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label>
          Project brief
          <textarea
            aria-label="Project brief"
            required
            minLength={20}
            maxLength={6000}
            rows={7}
            value={draft.brief}
            onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
          />
        </label>
        <label>
          What changed? (optional)
          <textarea
            rows={2}
            maxLength={1000}
            value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
          />
        </label>
        <p>
          Team: {WORKFLOWS[project.workflow || 'office'].label}. Saving does not regenerate the plan
          or redo completed work. Review assignments and earlier outputs against the revised brief.
        </p>
        {project.status === 'running' && (
          <p>
            Pause this project before saving. Your edits are saved as a browser draft when you
            close.
          </p>
        )}
        <div className="file-actions">
          <button type="button" className="button secondary small" onClick={onPlan}>
            Edit tasks & dependencies
          </button>
          <button type="button" className="button secondary small" onClick={onConnection}>
            Change this project's model
          </button>
          <button type="button" className="button secondary small" onClick={onTeam}>
            Manage project team
          </button>
        </div>
        {!!project.briefHistory?.length && (
          <details>
            <summary>Previous project versions ({project.briefHistory.length})</summary>
            {[...project.briefHistory].reverse().map((version, i) => (
              <article key={i}>
                <strong>{version.title}</strong>
                <p>
                  {new Date(version.changedAt).toLocaleString()} · {version.reason}
                </p>
                <pre>{version.brief}</pre>
              </article>
            ))}
          </details>
        )}
        <p role="status">
          {draftError || 'Changes saved as a browser draft until you save the project.'}
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          className="text-button"
          onClick={() =>
            download(`${draft.title || 'project'}-brief.md`, `# ${draft.title}\n\n${draft.brief}`)
          }
        >
          Download edited brief
        </button>
        <button type="button" className="text-button" onClick={clearDraft}>
          Reload saved project · discard these edits
        </button>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Close · keep draft
          </button>
          <button className="button primary" disabled={busy || project.status === 'running'}>
            {busy ? 'Saving…' : 'Save project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
