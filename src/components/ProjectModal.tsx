import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { Project, Provider, Workflow, ReasoningEffort } from '../../shared/types';
import { WORKFLOWS } from '../../shared/workflows';
import { api, download } from '../api';
import Modal from './Modal';

export const PROJECT_DRAFT_KEY = 'workroom-project-draft-v1';
type Draft = {
  title: string;
  brief: string;
  workflow: Workflow;
  planning: 'template' | 'ai' | 'manual';
  requestId: string;
  reasoningEffort?: ReasoningEffort;
  meetings?: boolean;
  researchEnabled?: boolean;
};
const fresh = (): Draft => ({
  title: '',
  brief: '',
  workflow: 'office',
  planning: 'ai',
  requestId: crypto.randomUUID(),
  reasoningEffort: 'medium',
  meetings: false,
});
function readDraft(provider: Provider): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(PROJECT_DRAFT_KEY) || 'null');
    if (
      d &&
      typeof d.title === 'string' &&
      typeof d.brief === 'string' &&
      d.workflow in WORKFLOWS &&
      ['ai', 'template', 'manual'].includes(d.planning) &&
      /^[0-9a-f-]{36}$/.test(d.requestId)
    )
      return {
        ...d,
        planning: d.planning === 'template' && provider !== 'demo' ? 'manual' : d.planning,
      };
  } catch {
    /* A storage warning is shown by the save effect. */
  }
  const draft = fresh();
  if (provider === 'demo') draft.planning = 'template';
  if (provider === 'external') draft.planning = 'manual';
  return draft;
}
export default function ProjectModal({
  onClose,
  onCreated,
  provider,
  model,
  onConfigure,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  provider: Provider;
  model?: string;
  onConfigure?: () => void;
}) {
  const [draft, setDraft] = useState(() => readDraft(provider));
  const [storage, setStorage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify(draft));
      setStorage('Draft saved in this browser. Closing this dialog keeps your writing.');
    } catch {
      setStorage('Browser storage is unavailable. Download your brief before closing this tab.');
    }
  }, [draft]);
  function change(values: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...values, requestId: crypto.randomUUID() }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await api<{ project: Project }>('/projects', {
        ...draft,
        documentPack: 'office',
        collaboration: {
          researchEnabled: !!draft.researchEnabled,
          reasoningEffort: draft.reasoningEffort || 'medium',
          meetingPolicy: {
            enabled: provider !== 'external' && (draft.meetings ?? false),
            everyTasks: 3,
          },
        },
      });
      try {
        localStorage.removeItem(PROJECT_DRAFT_KEY);
      } catch {
        /* Already saved on server. */
      }
      onCreated(result.project.id);
    } catch (err) {
      setError(
        (err as Error).message +
          ' Your draft is retained. You can submit again without duplicating the same project.',
      );
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Modal
      title="Create a project"
      subtitle="Save the goal, choose a team, then customize its plan."
      onClose={submitting ? () => {} : onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="planning-note">
          <strong>Model: {model || provider}</strong>
          <p>
            The selected model writes the plan and performs text assignments. File editing and
            command execution require Codex tools.
          </p>
          {onConfigure && (
            <button type="button" className="text-button" onClick={onConfigure}>
              Change model connection
            </button>
          )}
        </div>
        <label>
          Project name
          <input
            autoFocus
            required
            minLength={2}
            maxLength={80}
            value={draft.title}
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        <label>
          The brief
          <span className="field-hint">
            Goal, requested deliverables, constraints, available evidence, and what success means.
          </span>
          <textarea
            required
            minLength={20}
            maxLength={6000}
            rows={7}
            value={draft.brief}
            onChange={(e) => change({ brief: e.target.value })}
            placeholder="What should this team accomplish?"
          />
        </label>
        <label>
          Team & workflow
          <select
            aria-label="Team & workflow"
            value={draft.workflow}
            onChange={(e) => change({ workflow: e.target.value as Workflow })}
          >
            {Object.entries(WORKFLOWS).map(([id, w]) => (
              <option value={id} key={id} disabled={id === 'software' && provider !== 'codex'}>
                {w.label}
              </option>
            ))}
          </select>
          <span className="field-hint">{WORKFLOWS[draft.workflow].description}</span>
        </label>
        <div className="team-preview">
          {WORKFLOWS[draft.workflow].roles.map((role, i) => (
            <span key={role}>
              {i + 1}. {role}
            </span>
          ))}
        </div>
        <label>
          Task planning
          <select
            aria-label="Task planning"
            value={draft.planning}
            onChange={(e) => change({ planning: e.target.value as Draft['planning'] })}
          >
            <option value="manual">Write my own tasks · starts with an empty plan</option>
            {provider === 'demo' && <option value="template">Legacy test fixture</option>}
            <option value="ai" disabled={provider === 'demo' || provider === 'external'}>
              AI plan tailored to the brief · uses allowance or budget
            </option>
          </select>
          <span className="field-hint">
            Add, remove and edit tasks, owners, instructions and dependencies before running. There
            is no fixed step count.
          </span>
        </label>
        {provider === 'codex' && (
          <>
            <label>
              Codex reasoning effort
              <select
                aria-label="Codex reasoning effort"
                value={draft.reasoningEffort || 'medium'}
                onChange={(e) => change({ reasoningEffort: e.target.value as ReasoningEffort })}
              >
                <option value="low">Economy · low</option>
                <option value="medium">Balanced · medium</option>
                <option value="high">Deep work · high</option>
              </select>
              <span className="field-hint">
                High uses more allowance; the selected model must support it. Other providers use
                their configured defaults.
              </span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!draft.researchEnabled}
                onChange={(e) => change({ researchEnabled: e.target.checked })}
              />
              Allow Codex web research (read-only search; applies to text work, not coding tools)
            </label>
          </>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={provider === 'external'}
            checked={provider !== 'external' && (draft.meetings ?? false)}
            onChange={(e) => change({ meetings: e.target.checked })}
          />
          Automatic kickoff and progress meetings
        </label>
        <p className="field-hint">
          A normal meeting uses five model requests, plus bounded corrections for malformed replies.
          It records proposals, critique and next actions. Leave off to save model calls; request a
          meeting when useful. Change the cadence in Edit plan.
        </p>
        {draft.workflow === 'software' && (
          <p className="planning-note">
            Software tasks require the Codex connection. Each role works in the same managed project
            folder. Tool network starts disabled; enable it in Edit plan if dependency downloads are
            needed.
          </p>
        )}
        <p className="field-hint" role="status">
          {storage}
        </p>
        <div className="draft-actions">
          <button
            type="button"
            className="text-button"
            onClick={() =>
              download(`${draft.title || 'project'}-brief.md`, `# ${draft.title}\n\n${draft.brief}`)
            }
          >
            Download brief
          </button>
          <button
            type="button"
            className="text-button"
            disabled={submitting}
            onClick={() =>
              setDraft({
                ...fresh(),
                planning:
                  provider === 'external' ? 'manual' : provider === 'demo' ? 'template' : 'ai',
              })
            }
          >
            Clear draft
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={submitting}
            onClick={onClose}
          >
            Save for later
          </button>
          <button className="button primary" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            {submitting ? 'Saving project…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
