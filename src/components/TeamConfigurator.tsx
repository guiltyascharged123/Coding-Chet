import { useState } from 'react';
import type { Agent, Project } from '../../shared/types';
import { expandTeam, OFFICE_CAPACITIES, type OfficeCapacity } from '../../shared/team';
import { SPECIALISTS } from '../../shared/specialists';
import { api } from '../api';
import { useSavedDraft } from '../drafts';

export default function TeamConfigurator({
  project,
  team,
  active = false,
}: {
  project: Project;
  team: Agent[];
  active?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState('');
  return (
    <section className="team-configurator" aria-label="Office and specialists">
      <div className="section-header">
        <h2>
          {project.officeCapacity || 4}-desk office · {team.length} agents
        </h2>
        <button className="button secondary" onClick={() => setOpen(!open)}>
          {open ? 'Close team setup' : 'Choose office & specialists'}
        </button>
      </div>
      {open && (
        <TeamEditor
          project={project}
          team={team}
          active={active}
          onSaved={() => {
            setOpen(false);
            setMessage(
              'Office and specialist roles saved. Existing task assignments remain; restart with a new plan to plan for the new team.',
            );
          }}
        />
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function TeamEditor({
  project,
  team,
  active,
  onSaved,
}: {
  project: Project;
  team: Agent[];
  active: boolean;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [draft, save, clear, error] = useSavedDraft(`workroom-team-${project.id}`, {
    capacity: project.officeCapacity || 4,
    members: team,
    expectedRevision: project.teamRevision || 0,
  });
  const locked = active || project.status === 'running' || project.planningStatus === 'planning';
  return (
    <form
      className="modal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          if (draft.expectedRevision === undefined)
            throw new Error(
              'Copy your edits, then reload the saved team to update this older draft.',
            );
          await api(`/projects/${project.id}/team`, draft, 'PUT');
          clear();
          onSaved();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Office space
        <select
          aria-label="Office space"
          value={draft.capacity}
          disabled={busy || locked}
          onChange={(event) => {
            const capacity = Number(event.target.value) as OfficeCapacity;
            const fitting = draft.members.filter((agent) => agent.desk < capacity);
            save({ ...draft, capacity, members: expandTeam(fitting, capacity, project.workflow) });
          }}
        >
          {OFFICE_CAPACITIES.map((n) => (
            <option key={n} value={n}>
              {n === 4 ? 'Studio' : n === 8 ? 'Office' : 'Headquarters'} · {n} agents
            </option>
          ))}
        </select>
      </label>
      <p>
        Choose from {SPECIALISTS.length} specialist roles. Every role uses the project’s selected
        model and shared evidence. The workspace concurrency limit controls how many work at once.
      </p>
      <div className="specialist-picker-grid">
        {draft.members.map((agent) => (
          <label key={agent.id}>
            {agent.name} · desk {agent.desk + 1}
            <select
              aria-label={`${agent.name} specialist`}
              value={SPECIALISTS.some((p) => p.role === agent.role) ? agent.role : '__custom'}
              disabled={busy || locked}
              onChange={(e) => {
                const preset = SPECIALISTS.find((p) => p.role === e.target.value);
                if (preset)
                  save({
                    ...draft,
                    members: draft.members.map((a) =>
                      a.id === agent.id ? { ...a, ...preset } : a,
                    ),
                  });
              }}
            >
              {!SPECIALISTS.some((p) => p.role === agent.role) && (
                <option value="__custom">{agent.role} · custom</option>
              )}
              {SPECIALISTS.map((preset) => (
                <option key={preset.role} value={preset.role}>
                  {preset.role}
                </option>
              ))}
            </select>
            <span className="field-hint">{agent.goal || agent.specialty}</span>
          </label>
        ))}
      </div>
      {locked && <p>Pause this project before saving office or role changes.</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="text-button" disabled={busy} onClick={clear}>
        Reload saved team · discard draft
      </button>
      {message && <p role="alert">{message}</p>}
      <button className="button primary" disabled={busy || locked}>
        Save office and team
      </button>
    </form>
  );
}
