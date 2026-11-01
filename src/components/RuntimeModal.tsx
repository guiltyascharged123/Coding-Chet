import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import type { Bootstrap, Project, Provider, ConnectionInfo } from '../../shared/types';
import { PROVIDER_LABELS } from '../../shared/types';
import { connectionInfo, CONNECTION_LABELS } from '../../shared/connections';
import { modelReadiness } from '../../shared/model-readiness';
import { api } from '../api';
import Modal from './Modal';
import BrandMark from './BrandMark';
import ConnectionSetup from './ConnectionSetup';
import type { ReactNode } from 'react';

function ConnectionPage({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <main className="connections-page">
      <header className="connections-page-heading">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onClose();
          }}
          aria-label="Workroom · Workspace"
        >
          <BrandMark />
          <span>workroom.</span>
        </a>
        <button className="button secondary" onClick={onClose}>
          Back to workspace
        </button>
      </header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </main>
  );
}
function ConnectionStatus({ info }: { info: ConnectionInfo }) {
  return (
    <span className={`model-connection-status ${info.state}`} role="status">
      <span className={`connection-beacon ${info.state}`} aria-hidden="true" />
      {CONNECTION_LABELS[info.state]}
    </span>
  );
}

export default function RuntimeModal({
  data,
  onClose,
  onChange,
  onRefresh,
  project,
  serverConnected,
  onProjectConnection,
  inline = false,
}: {
  inline?: boolean;
  data: Bootstrap;
  onClose: () => void;
  onChange: (provider: Provider) => Promise<void>;
  onRefresh: (data: Bootstrap) => void;
  project?: Project;
  serverConnected: boolean;
  onProjectConnection?: () => void;
}) {
  const [openSetup, setOpenSetup] = useState<string | undefined>(project?.provider);
  const blocked =
    !!data.connectionChange ||
    data.state.projects.some((p) => p.status === 'running' || p.planningStatus === 'planning') ||
    data.state.tasks.some((t) => t.status === 'working') ||
    (data.state.meetings || []).some((m) => m.status === 'running' || m.status === 'gathering');
  const Shell = inline ? ConnectionPage : Modal;
  const [saving, setSaving] = useState(true);
  useEffect(() => {
    void check();
  }, []);
  async function check() {
    setSaving(true);
    try {
      const updated = await api<Bootstrap>('/connections/check', { projectId: project?.id });
      onRefresh(updated);
      setMessage('Connection checks finished. No model was run; generation quota is not tested.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const projectConnection = project
    ? connectionInfo(data.runtime, project.provider, project.model)
    : undefined;
  const [message, setMessage] = useState('');
  const descriptions: Partial<Record<Provider, string>> = {
    ollama:
      'Runs on this computer. Local setup installs Ollama and downloads your selected model. Text work; no file or command tools.',
    codex:
      'Uses your ChatGPT Codex sign-in and allowance. Supports text work, optional search, and managed file/command tools after the sandbox check.',
    openai:
      'Requires an OpenAI API key, model access and separate API billing. Text work in this adapter.',
    gemini: 'Uses a Google AI Studio / Gemini API key and its quota. Text work in this adapter.',
    compatible:
      'Connect LM Studio, llama.cpp or another OpenAI-compatible Chat Completions server. Tools depend on the external worker you build.',
    external:
      'Attach your own running worker through the authenticated task-leasing API. Its model, tools and costs are managed separately.',
  };
  return (
    <Shell
      title="Model connections"
      subtitle="Check model services and ChatGPT sign-in. Defaults apply to new projects; each saved project keeps its selected model."
      onClose={onClose}
    >
      <div className="runtime-check">
        <p className="server-connection-summary">
          <span
            className={`connection-beacon ${serverConnected ? 'connected' : 'unavailable'}`}
            aria-hidden="true"
          />
          Workroom server: {serverConnected ? 'connected' : 'reconnecting'}. This is separate from
          model access.
        </p>
        {data.connectionChange && <p role="status">{data.connectionChange}</p>}
        <p className="field-hint">
          Green means the service or sign-in check succeeded. Amber means configured but unchecked.
          These checks do not generate work or prove remaining allowance.
        </p>
        {project && projectConnection && (
          <section className="project-connection-summary" aria-label="Current project connection">
            <strong>{project.title}</strong>
            <p>
              {PROVIDER_LABELS[project.provider]} · {project.model || 'No model ID selected'}
            </p>
            <ConnectionStatus info={projectConnection} />
            <p>{projectConnection.message}</p>
            {onProjectConnection && (
              <button className="button secondary small" onClick={onProjectConnection}>
                Change this project's connection
              </button>
            )}
          </section>
        )}

        <button className="button secondary" disabled={saving} onClick={() => void check()}>
          {saving ? 'Checking connections…' : 'Check connections'}
        </button>
        <p role="status">{message}</p>
        <p>
          For local models, open Configure connection under Ollama for installation and download
          instructions. Then check connections here. Changing a project's model is available through
          its Model → Change control.
        </p>
      </div>
      <div className="runtime-options">
        {(['ollama', 'codex', 'openai', 'gemini', 'compatible', 'external'] as Provider[]).map(
          (provider) => {
            const ready = modelReadiness(data.runtime, provider).ready;
            const status = connectionInfo(data.runtime, provider);
            const model =
              provider !== 'demo' && provider !== 'external' ? data.runtime.models[provider] : '';
            return (
              <article
                className={`runtime-option ${data.state.provider === provider ? 'chosen' : ''}`}
                key={provider}
                aria-label={`${PROVIDER_LABELS[provider]} connection`}
              >
                <span className={`provider-icon provider-${provider}`}>
                  <Zap size={20} />
                </span>
                <div>
                  <strong>
                    {PROVIDER_LABELS[provider]}{' '}
                    {data.state.provider === provider && <span className="tag">Default</span>}
                  </strong>
                  {model && <p className="provider-model">{model}</p>}
                  <p>{descriptions[provider]}</p>
                  <ConnectionStatus info={status} />
                  <small>{status.message}</small>
                  {status.checkedAt && (
                    <small>Checked {new Date(status.checkedAt).toLocaleTimeString()}</small>
                  )}
                  {(provider === 'ollama' || provider === 'compatible') &&
                    !!data.runtime.listedModels?.[provider]?.length && (
                      <details>
                        <summary>
                          Installed / served models ({data.runtime.listedModels[provider]!.length})
                        </summary>
                        <ul>
                          {data.runtime.listedModels[provider]!.map((id) => (
                            <li key={id}>
                              <code>{id}</code>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  <div className="provider-actions">
                    {provider !== 'external' && (
                      <button
                        className="button secondary small"
                        onClick={() => setOpenSetup(openSetup === provider ? undefined : provider)}
                      >
                        {openSetup === provider
                          ? 'Close setup'
                          : provider === 'codex'
                            ? 'Set up / sign in'
                            : 'Configure connection'}
                      </button>
                    )}
                    <button
                      className="button secondary small"
                      disabled={!ready || saving || data.state.provider === provider}
                      title={
                        !ready
                          ? 'Complete setup using the guide, then check connections.'
                          : undefined
                      }
                      onClick={async () => {
                        setSaving(true);
                        try {
                          await onChange(provider);
                        } catch (e) {
                          setMessage((e as Error).message);
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      {data.state.provider === provider
                        ? 'Selected default'
                        : 'Use for new projects'}
                    </button>
                    <a
                      href={`https://github.com/guiltyascharged123/Coding-Chet/blob/workroom-starter/docs/LOCAL-MODELS.md#${provider}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Setup guide ↗
                    </a>
                  </div>
                  {provider !== 'external' && openSetup === provider && (
                    <ConnectionSetup
                      key={provider}
                      provider={provider as Exclude<Provider, 'demo' | 'external'>}
                      onRefresh={onRefresh}
                      blocked={blocked}
                      projectModel={project?.provider === provider ? project.model : undefined}
                    />
                  )}
                </div>
              </article>
            );
          },
        )}
      </div>
      <p>
        Local models use your hardware. Paid APIs remain disabled until enabled with price estimates
        in Workspace controls. No automatic model or paid fallback is used.
      </p>
      {data.runtime.coding && (
        <p>
          <strong>Codex coding tools: {data.runtime.coding.ready ? 'Ready' : 'Not ready'}</strong>
          <br />
          {data.runtime.coding.message}
        </p>
      )}
    </Shell>
  );
}
