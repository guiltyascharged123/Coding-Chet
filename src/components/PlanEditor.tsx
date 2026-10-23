import { useState } from 'react';
import type { Agent, Project, Task, ReasoningEffort } from '../../shared/types';
import { api } from '../api';
import Modal from './Modal';
import { useSavedDraft } from '../drafts';
import { hasProjectTools } from '../../shared/capabilities';

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
  const [draft, saveDraft, clearDraft, draftError] = useSavedDraft(
    `workroom-plan-draft-${project.id}`,
    {
      rows: structuredClone(tasks),
      network: !!project.toolNetwork,
      effort: project.reasoningEffort || ('medium' as ReasoningEffort),
      meetings: !!project.meetingPolicy?.enabled,
      researchEnabled: !!project.researchEnabled,
      cadence: project.meetingPolicy?.everyTasks || 3,
    },
  );
  const { rows, network, effort, meetings, cadence } = draft;
  const setRows = (update: Task[] | ((rows: Task[]) => Task[])) =>
    saveDraft({ ...draft, rows: typeof update === 'function' ? update(rows) : update });
  const setNetwork = (network: boolean) => saveDraft({ ...draft, network });
  const setEffort = (effort: ReasoningEffort) => saveDraft({ ...draft, effort });
  const setMeetings = (meetings: boolean) => saveDraft({ ...draft, meetings });
  const setCadence = (cadence: number) => saveDraft({ ...draft, cadence });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function change(id: string, values: Partial<Task>) {
    setRows((r) => r.map((t) => (t.id === id ? { ...t, ...values } : t)));
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api(
        `/projects/${project.id}/plan`,
        {
          tasks: rows,
          toolNetwork: network,
          collaboration: {
            researchEnabled: draft.researchEnabled,
            reasoningEffort: effort,
            meetingPolicy: { enabled: meetings, everyTasks: cadence },
          },
        },
        'PUT',
      );
      clearDraft();
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
        <fieldset className="plan-row">
          <legend>Collaboration & reasoning</legend>
          <label>
            Codex reasoning effort
            <select
              aria-label="Codex reasoning effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value as ReasoningEffort)}
            >
              <option value="low">Economy · low</option>
              <option value="medium">Balanced · medium</option>
              <option value="high">Deep work · high</option>
            </select>
            <span className="field-hint">
              Higher reasoning can improve difficult work and consume more allowance. This controls
              Codex; other providers use their configured defaults.
            </span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.researchEnabled}
              onChange={(e) => saveDraft({ ...draft, researchEnabled: e.target.checked })}
            />
            Allow Codex web research (read-only searches with cited sources)
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              disabled={project.provider === 'external'}
              checked={meetings}
              onChange={(e) => setMeetings(e.target.checked)}
            />
            Automatic team meetings
          </label>
          <label>
            Completed tasks between meetings
            <input
              aria-label="Completed tasks between meetings"
              type="number"
              min={1}
              max={20}
              value={cadence}
              onChange={(e) => setCadence(Number(e.target.value))}
            />
          </label>
          <p className="field-hint">
            Kickoff, then progress checkpoints when more work is ready. A normal meeting adds five
            model requests; malformed replies can add one correction per turn. Existing limits
            apply; completed contributions survive retries. Settings save with this plan.
          </p>
        </fieldset>
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
              {hasProjectTools(project) && (
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
        {hasProjectTools(project) && (
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
        <p className="field-hint" role="status">
          {draftError || 'Plan edits saved as a browser draft until you save them to the project.'}
        </p>
        <button type="button" className="text-button" onClick={clearDraft}>
          Discard local plan edits · reload saved plan
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            Close · keep draft
          </button>
          <button className="button primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
