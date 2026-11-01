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
    void check(true);
  }, []);
  async function check(automatic = false) {
    setSaving(true);
    try {
      const updated = await api<Bootstrap>('/connections/check', {
        projectId: project?.id,
        useCurrentSignIn: !automatic,
      });
      onRefresh(updated);
      setMessage('Connections checked.');
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
    ollama: 'Local text models.',
    codex: 'ChatGPT sign-in and Codex allowance.',
    openai: 'API key · separate API billing.',
    gemini: 'Google AI Studio API key.',
    compatible: 'LM Studio, llama.cpp and compatible servers.',
    external: 'Your own task worker.',
  };
  return (
    <Shell
      title="Model connections"
      subtitle="Connect a model or manage sign-in."
      onClose={onClose}
    >
      <div className="runtime-check">
        <p className="server-connection-summary">
          <span
            className={`connection-beacon ${serverConnected ? 'connected' : 'unavailable'}`}
            aria-hidden="true"
          />
          Workroom server: {serverConnected ? 'connected' : 'reconnecting'}.
        </p>
        {data.connectionChange && <p role="status">{data.connectionChange}</p>}
        <p className="field-hint">
          Green: connection checked. Amber: not checked. Checks do not test generation or remaining
          quota.
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
                  {status.state !== 'connected' && <small>{status.message}</small>}
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
      <details className="connection-notes">
        <summary>Limits and coding tools</summary>
        <p>Saved projects keep their model. API spending stays controlled in Workspace controls.</p>
        {data.runtime.coding && (
          <p>
            Codex coding tools: {data.runtime.coding.ready ? 'Ready' : 'Not ready'}.{' '}
            {data.runtime.coding.message}
          </p>
        )}
      </details>
    </Shell>
  );
}
