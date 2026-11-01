import { useEffect, useId, useState } from 'react';
import type { Bootstrap, Project, Provider } from '../../shared/types';
import { PROVIDER_LABELS } from '../../shared/types';
import { api } from '../api';
import { hasProjectTools } from '../../shared/capabilities';
import { modelReadiness } from '../../shared/model-readiness';

export default function ProjectModelSelector({
  data,
  project,
  onRefresh,
}: {
  data: Bootstrap;
  project: Project;
  onRefresh?: (data: Bootstrap) => void;
}) {
  const [provider, setProvider] = useState(project.provider);
  const [model, setModel] = useState(project.model || '');
  const [tools, setTools] = useState(hasProjectTools(project));
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const list = useId();
  useEffect(() => {
    setProvider(project.provider);
    setModel(project.model || '');
    setTools(hasProjectTools(project));
  }, [project.id, project.provider, project.model, project.workMode]);
  const locked =
    !!data.connectionChange ||
    project.status === 'running' ||
    project.planningStatus === 'planning' ||
    data.state.tasks.some((t) => t.projectId === project.id && t.status === 'working') ||
    data.state.meetings?.some(
      (m) => m.projectId === project.id && ['gathering', 'running'].includes(m.status),
    );
  const choices = [
    ...new Set(
      [
        data.runtime.models[provider as keyof typeof data.runtime.models],
        ...(data.runtime.listedModels?.[provider as 'ollama' | 'compatible'] || []),
        ...data.state.projects.filter((p) => p.provider === provider).map((p) => p.model),
      ].filter(Boolean),
    ),
  ];
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api(`/projects/${project.id}/runtime`, {
        provider,
        model,
        workMode: tools && provider === 'codex' ? 'workspace' : 'text',
      });
      const response = await fetch('/api/state');
      if (response.ok) onRefresh?.(await response.json());
      setMessage('Project model saved. Upcoming assignments will use this selection.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="project-model-selector" aria-label="Selected project model">
      <h2>Model used by {project.title}</h2>
      <p className="selected-project-model">
        <strong>Selected: {PROVIDER_LABELS[project.provider]}</strong>
        <code>
          {project.model ||
            (project.provider === 'external' ? 'Worker-managed model' : 'No model ID')}
        </code>
      </p>
      <p>All roles in this project use this selection. Connected models are available choices.</p>
      <form onSubmit={save}>
        <label>
          Project connection
          <select
            aria-label="Project connection"
            value={provider}
            disabled={busy || locked}
            onChange={(event) => {
              const next = event.target.value as Provider;
              setProvider(next);
              setModel(
                next === project.provider
                  ? project.model || ''
                  : next === 'external'
                    ? ''
                    : data.runtime.models[next as keyof typeof data.runtime.models] || '',
              );
              if (next !== 'codex') setTools(false);
              else if (project.workflow === 'software') setTools(true);
            }}
          >
            {Object.entries(PROVIDER_LABELS)
              .filter(([id]) => id !== 'demo' || project.provider === 'demo')
              .map(([id, label]) => (
                <option
                  key={id}
                  value={id}
                  disabled={project.workflow === 'software' && id !== 'codex'}
                >
                  {label}
                </option>
              ))}
          </select>
        </label>
        {provider !== 'external' && provider !== 'demo' && (
          <label>
            Project model ID
            {!!choices.length && (
              <select
                aria-label="Available project model"
                value={choices.includes(model) ? model : '__custom'}
                disabled={busy || locked}
                onChange={(event) =>
                  setModel(event.target.value === '__custom' ? '' : event.target.value)
                }
              >
                {choices.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                <option value="__custom">Enter a different model ID below</option>
              </select>
            )}
            <input
              aria-label="Project model ID"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              maxLength={150}
              list={list}
              disabled={busy || locked}
            />
            <datalist id={list}>
              {choices.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>
        )}
        {provider === 'codex' && (
          <label className="check-row">
            <input
              type="checkbox"
              aria-label="Enable managed project tools"
              checked={tools}
              disabled={busy || locked || project.workflow === 'software'}
              onChange={(e) => setTools(e.target.checked)}
            />
            Enable shared coding folder and commands
          </label>
        )}
        {locked && (
          <div>
            <p className="field-hint">Pause this project before changing its model.</p>
            {!data.connectionChange && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setMessage('');
                  try {
                    await api(`/projects/${project.id}/pause`);
                    const response = await fetch('/api/state');
                    if (response.ok) onRefresh?.(await response.json());
                    setMessage(
                      'Pause requested. Allow any stopping worker to finish before saving a new model.',
                    );
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Pause project
              </button>
            )}
          </div>
        )}
        {!modelReadiness(data.runtime, provider, model).ready && (
          <p className="field-hint">{modelReadiness(data.runtime, provider, model).message}</p>
        )}
        <button className="button primary" disabled={busy || locked}>
          Use this model for this project
        </button>
        {(provider !== project.provider ||
          model !== (project.model || '') ||
          tools !== hasProjectTools(project)) && (
          <p className="field-hint">
            This selection has not been applied. Use the button above to save it.
          </p>
        )}
        <p className="field-hint">
          Changing the default for new projects does not change this project. Selection does not
          send a generation request.
        </p>
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
