import { useState } from 'react';
import type { Agent, Project, Task } from '../../shared/types';
import { api } from '../api';
import Modal from './Modal';

export default function PlanEditor({
  project,
  tasks,
  team,
  onClose,
}: {
  project: Project;
  tasks: Task[];
  team: Agent[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => structuredClone(tasks));
  const [network, setNetwork] = useState(!!project.toolNetwork);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function change(id: string, values: Partial<Task>) {
    setRows((r) => r.map((t) => (t.id === id ? { ...t, ...values } : t)));
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${project.id}/plan`, { tasks: rows, toolNetwork: network }, 'PUT');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title="Edit task plan"
      subtitle="Define useful work, acceptance criteria and handoffs. Pause the team before saving."
      onClose={onClose}
    >
      <div className="modal-form plan-editor">
        <p>
          Tasks that have already completed or reached review retain their results. Add follow-up
          tasks to extend a project. Changes take effect when you save.
        </p>
        {rows.map((t, i) => {
          const locked = !['queued', 'failed'].includes(t.status);
          return (
            <fieldset className="plan-row" key={t.id} disabled={busy || locked}>
              <legend>
                Task {i + 1}
                {locked ? ` · ${t.status} · retained` : ''}
              </legend>
              <label>
                Task title
                <input
                  aria-label={`Task ${i + 1} title`}
                  value={t.title}
                  maxLength={100}
                  onChange={(e) => change(t.id, { title: e.target.value })}
                />
              </label>
              <label>
                Assignment & acceptance criteria
                <textarea
                  aria-label={`Task ${i + 1} assignment`}
                  rows={4}
                  maxLength={4000}
                  value={t.description}
                  onChange={(e) => change(t.id, { description: e.target.value })}
                />
              </label>
              <label>
                Assigned agent
                <select
                  aria-label={`Task ${i + 1} agent`}
                  value={t.agentId}
                  onChange={(e) => change(t.id, { agentId: e.target.value })}
                >
                  {team.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name} · {a.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={t.requiresApproval}
                  onChange={(e) => change(t.id, { requiresApproval: e.target.checked })}
                />
                Human approval before handoff
              </label>
              {project.workflow === 'software' && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!t.readOnly}
                    onChange={(e) => change(t.id, { readOnly: e.target.checked })}
                  />
                  Inspect only (source files are read-only)
                </label>
              )}
              <details>
                <summary>Dependencies ({t.dependencies.length})</summary>
                <div className="dependency-options">
                  {rows
                    .filter((d) => d.id !== t.id)
                    .map((d) => (
                      <label className="checkbox-label" key={d.id}>
                        <input
                          type="checkbox"
                          checked={t.dependencies.includes(d.id)}
                          onChange={(e) =>
                            change(t.id, {
                              dependencies: e.target.checked
                                ? [...t.dependencies, d.id]
                                : t.dependencies.filter((id) => id !== d.id),
                            })
                          }
                        />
                        {d.title}
                      </label>
                    ))}
                </div>
              </details>
              {t.status === 'queued' && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setRows((r) =>
                      r
                        .filter((row) => row.id !== t.id)
                        .map((row) => ({
                          ...row,
                          dependencies: row.dependencies.filter((id) => id !== t.id),
                        })),
                    )
                  }
                >
                  Remove task
                </button>
              )}
            </fieldset>
          );
        })}
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            setRows((r) => [
              ...r,
              {
                id: crypto.randomUUID(),
                projectId: project.id,
                title: 'New assignment',
                description: 'Describe the action, expected result and acceptance criteria.',
                agentId: team[0].id,
                dependencies: r.length ? [r[r.length - 1].id] : [],
                requiresApproval: false,
                status: 'queued',
                output: '',
                feedback: '',
              },
            ])
          }
        >
          Add task
        </button>
        {project.workflow === 'software' && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={network}
              onChange={(e) => setNetwork(e.target.checked)}
            />
            Allow tool network for this project (for example, dependency downloads). Code and
            installed packages can make internet requests when enabled.
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
