import { useState, type FormEvent } from 'react';
import type { Bootstrap, CostPolicy, Project } from '../../shared/types';
import { defaultPolicy } from '../../shared/schemas';
import { PROVIDER_LABELS } from '../../shared/types';
import { api, saveBlob } from '../api';
import Modal from './Modal';
import { useSavedDraft } from '../drafts';

export default function WorkspaceControls({
  data,
  project,
  onClose,
  initialTab = 'limits',
}: {
  data: Bootstrap;
  project: Project;
  onClose: () => void;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab),
    [draft, setDraft] = useState<CostPolicy>(() =>
      structuredClone(data.state.policy || defaultPolicy),
    ),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [memoryDraft, saveMemoryDraft, clearMemoryDraft, memoryDraftError] = useSavedDraft(
    `workroom-memory-draft-${project.id}`,
    { content: '', source: '' },
  );
  const memory = memoryDraft.content || '',
    source = memoryDraft.source || '';
  const setMemory = (content: string) => saveMemoryDraft({ content, source });
  const setSource = (source: string) => saveMemoryDraft({ content: memory, source });
  const [restore, setRestore] = useState<unknown>(),
    [confirmed, setConfirmed] = useState(false);
  const [connection, setConnection] = useState(project.provider);
  async function act(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportBackup() {
    const response = await fetch('/api/backup');
    if (!response.ok) throw new Error('Backup export failed.');
    saveBlob(
      `workroom-backup-${new Date().toISOString().slice(0, 10)}.json`,
      await response.blob(),
    );
  }
  const attempts = data.attempts || [],
    recent = attempts.filter((a) => a.status !== 'cached' && a.createdAt >= Date.now() - 86400000);
  const fields: [keyof CostPolicy, string, number, number][] = [
    ['maxConcurrent', 'Active tasks across the workspace', 1, 4],
    ['maxTasks', 'Tasks allowed per project', 1, 100],
    ['maxRevisions', 'Revisions allowed per task', 0, 20],
    ['maxRequests24h', 'Requests in the last 24 hours', 1, 10000],
    ['maxInputBytes', 'Maximum input bytes', 2000, 200000],
    ['maxOutputTokens', 'Maximum output tokens (API/local)', 256, 16000],
    ['dailyBudgetUsd', 'API estimate budget, rolling 24 hours ($)', 0, 1000],
    ['projectBudgetUsd', 'API estimate budget per project ($)', 0, 1000],
  ];
  return (
    <Modal
      title="Workspace controls"
      subtitle="Connections, limits, local memory, and portable backups."
      wide
      onClose={onClose}
    >
      <div className="controls-panel">
        <div className="controls-tabs" role="tablist" aria-label="Workspace controls">
          {[
            ['limits', 'Limits & connections'],
            ['usage', 'Usage'],
            ['memory', 'Project memory'],
            ['backup', 'Backup & restore'],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setMessage('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'limits' && (
          <>
            <section className="control-section">
              <h3>This project’s connection</h3>
              <p>
                Changing the default runtime affects new projects. This project keeps its selected
                connection and model until you explicitly change it here. Pause it first.
              </p>
              <div className="control-row">
                <select
                  aria-label="Project connection"
                  value={connection}
                  onChange={(e) => setConnection(e.target.value as typeof connection)}
                >
                  {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
                    <option
                      key={id}
                      value={id}
                      disabled={!data.runtime.available[id as typeof connection]}
                    >
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => api(`/projects/${project.id}/runtime`, { provider: connection }),
                      'Project connection updated; existing documents retained.',
                    )
                  }
                >
                  Set project connection
                </button>
              </div>
              <p>
                Current project: {PROVIDER_LABELS[project.provider]}
                {project.model ? ` · ${project.model}` : ''}. External workers have their own tools
                and billing; Workroom cannot meter their internal calls.
              </p>
            </section>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                act(() => api('/policy', draft), 'Workspace limits saved.');
              }}
              className="control-section"
            >
              <h3>Economy limits</h3>
              <p>
                One active task is the economical default. Limits pause work instead of discarding
                tasks. Planning, retries, and subscription jobs count toward request limits. Codex
                can use several model turns inside one job.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.allowPaid}
                  onChange={(e) => setDraft({ ...draft, allowPaid: e.target.checked })}
                />
                Enable separately billed API requests
              </label>
              <div className="controls-grid">
                {fields.map(([name, label, min, max]) => (
                  <label key={name}>
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      step={name.endsWith('Usd') ? '0.01' : '1'}
                      value={draft[name] as number}
                      required
                      onChange={(e) => setDraft({ ...draft, [name]: Number(e.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <h4>API price estimates</h4>
              <p>
                Enter current prices from your provider in USD per million tokens, matching the
                exact project model. These estimates govern app dispatch; they are not
                provider-account hard caps. Missing receipts retain the full reservation. Cancelling
                cannot undo usage already incurred.
              </p>
              {(['openai', 'gemini', 'compatible'] as const).map((provider) => (
                <div key={provider} className="price-row">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={!!draft.rates[provider]}
                      onChange={(e) => {
                        const rates = { ...draft.rates };
                        if (e.target.checked)
                          rates[provider] = {
                            model: data.runtime.models[provider],
                            inputPerMillion: NaN,
                            outputPerMillion: NaN,
                          };
                        else delete rates[provider];
                        setDraft({ ...draft, rates });
                      }}
                    />
                    {PROVIDER_LABELS[provider]}
                  </label>
                  {draft.rates[provider] && (
                    <div className="controls-grid">
                      <label>
                        Exact model
                        <input
                          required
                          aria-label={`${provider} price model`}
                          value={draft.rates[provider]!.model}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              rates: {
                                ...draft.rates,
                                [provider]: { ...draft.rates[provider]!, model: e.target.value },
                              },
                            })
                          }
                        />
                      </label>
                      {(['inputPerMillion', 'outputPerMillion'] as const).map((name) => (
                        <label key={name}>
                          {name === 'inputPerMillion' ? 'Input price' : 'Output price'}
                          <input
                            aria-label={`${provider} ${name}`}
                            type="number"
                            min="0"
                            max="1000"
                            step="any"
                            required
                            value={
                              Number.isFinite(draft.rates[provider]![name])
                                ? draft.rates[provider]![name]
                                : ''
                            }
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                rates: {
                                  ...draft.rates,
                                  [provider]: {
                                    ...draft.rates[provider]!,
                                    [name]: e.target.value === '' ? NaN : Number(e.target.value),
                                  },
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <button className="button primary" disabled={busy}>
                Save limits
              </button>
            </form>
          </>
        )}
        {tab === 'usage' && (
          <section className="control-section">
            <h3>Recorded requests</h3>
            <p>
              {recent.length} recorded requests in the last 24 hours (up to 500 recent receipts
              shown). Cached documents do not count. Subscription allowance and unrelated
              provider-account spending are not available here. Acknowledging an uncertain request
              permits retry; its reservation and request count remain.
            </p>
            {!attempts.length ? (
              <p>No model or worker requests recorded yet.</p>
            ) : (
              <div className="usage-list">
                {attempts.map((a) => (
                  <article key={a.id}>
                    <strong>
                      {PROVIDER_LABELS[a.provider]} · {a.phase} · {a.status}
                    </strong>
                    <span>
                      {data.state.projects.find((p) => p.id === a.projectId)?.title ||
                        'Earlier workspace'}{' '}
                      · {new Date(a.createdAt).toLocaleString()}
                    </span>
                    <p>
                      {a.model ? `${a.model} · ` : ''}
                      {a.provider === 'codex'
                        ? 'Subscription usage; remaining allowance unknown.'
                        : a.provider === 'external'
                          ? 'External worker usage is not metered.'
                          : a.provider === 'ollama' || a.billing === 'local'
                            ? 'Local computation; uses your hardware.'
                            : `API estimate held: $${a.reservedUsd.toFixed(4)}${a.actualUsd !== undefined ? ` · receipt estimate $${a.actualUsd.toFixed(4)}` : ''}`}
                      {a.inputTokens !== undefined
                        ? ` · input ${a.inputTokens}, output ${a.outputTokens ?? 'unknown'} tokens`
                        : ''}
                    </p>
                    {a.error && <p>{a.error}</p>}
                    {a.status === 'uncertain' && (
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () => api(`/attempts/${a.id}/acknowledge`),
                            'Uncertain attempt acknowledged. Retry remains subject to limits.',
                          )
                        }
                      >
                        Acknowledge uncertain usage
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        {tab === 'memory' && (
          <section className="control-section">
            <h3>Memory for {project.title}</h3>
            <p>
              Store requirements, decisions, and constraints you want this project’s agents to
              reuse. New entries are proposals until you verify them. Changed or unapproved source
              documents are excluded from model context. This is evidence storage, not model
              training or a guarantee of truth.
            </p>
            <label>
              Fact or decision
              <textarea
                aria-label="Memory content"
                rows={3}
                maxLength={3000}
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
              />
            </label>
            <p className="field-hint" role="status">
              {memoryDraftError ||
                'Memory draft saved in this browser. Propose and verify it explicitly to use it as a fact.'}
            </p>
            <label>
              Evidence source
              <select
                aria-label="Memory source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">Human supplied fact</option>
                {data.state.tasks
                  .filter((t) => t.projectId === project.id && t.status === 'done')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="button primary"
              disabled={busy || !memory.trim()}
              onClick={() =>
                act(async () => {
                  await api(`/projects/${project.id}/memory`, {
                    content: memory,
                    ...(source ? { sourceTaskId: source } : {}),
                  });
                  clearMemoryDraft();
                }, 'Memory proposal saved. Verify it after checking the evidence.')
              }
            >
              Propose memory
            </button>
            <div className="usage-list">
              {(data.state.memory || [])
                .filter((m) => m.projectId === project.id)
                .map((m) => (
                  <article key={m.id}>
                    <strong>
                      {m.stale
                        ? 'Source changed — excluded'
                        : m.status === 'verified'
                          ? 'Verified by you'
                          : 'Awaiting your verification'}
                    </strong>
                    <p>{m.content}</p>
                    <span>
                      Source:{' '}
                      {m.sourceTaskId
                        ? data.state.tasks.find((t) => t.id === m.sourceTaskId)?.title
                        : 'Human supplied'}
                    </span>
                    <div className="control-row">
                      {m.status === 'proposed' && !m.stale && (
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => api(`/memory/${m.id}`, { action: 'verify' }),
                              'Memory verified. Relevant future assignments can use it.',
                            )
                          }
                        >
                          Verify memory
                        </button>
                      )}
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() =>
                          act(() => api(`/memory/${m.id}`, { action: 'delete' }), 'Memory removed.')
                        }
                      >
                        Remove memory
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        )}
        {tab === 'backup' && (
          <section className="control-section">
            <h3>Move your workspace between computers</h3>
            <p>
              Export projects, task results, approvals, curated memory, limits, and request
              receipts. Source files in managed coding folders are separate; copy those folders or
              download their source ZIPs as well. Credentials and model weights are not included.
              Keep the file private: it contains your project data. Demo and normal workspaces have
              separate databases; export from the one you are using.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => act(exportBackup, 'Portable backup downloaded.')}
            >
              Download workspace backup
            </button>
            <h4>Restore a backup</h4>
            <p>
              Pause all work first. Restore replaces projects and documents. A recovery snapshot is
              written on the server, existing request receipts are retained, cached answers are
              cleared, and paid APIs are disabled after restore.
            </p>
            <input
              aria-label="Workspace backup file"
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                setRestore(undefined);
                setConfirmed(false);
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 25000000) {
                  setMessage('Backup is larger than 25 MB.');
                  return;
                }
                try {
                  setRestore(JSON.parse(await file.text()));
                  setMessage('Backup loaded for validation. It has not been restored.');
                } catch {
                  setMessage('This file is not valid JSON.');
                }
              }}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I understand this replaces the current projects and documents.
            </label>
            <button
              className="button secondary"
              disabled={busy || !restore || !confirmed}
              onClick={() =>
                act(
                  () => api('/restore', restore),
                  'Workspace restored. Paid APIs are off; select your project in the project menu.',
                )
              }
            >
              Restore workspace backup
            </button>
          </section>
        )}
        {message && (
          <p className="control-message" role="status">
            {message}
          </p>
        )}
      </div>
    </Modal>
  );
}
