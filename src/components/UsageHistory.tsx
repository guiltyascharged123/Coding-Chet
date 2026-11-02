import { useEffect, useRef, useState } from 'react';
import type { Attempt, Bootstrap } from '../../shared/types';
import { PROVIDER_LABELS } from '../../shared/types';
import { api } from '../api';

export default function UsageHistory({ data, projectId }: { data: Bootstrap; projectId?: string }) {
  const [filter, setFilter] = useState(data.usage?.uncertain ? 'uncertain' : '');
  const [scoped, setScoped] = useState(!!projectId);
  const [entries, setEntries] = useState<Attempt[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0);
  async function load(older = false) {
    const token = ++generation.current;
    setBusy(true);
    setError('');
    const query = new URLSearchParams();
    if (filter) query.set('status', filter);
    if (scoped && projectId) query.set('projectId', projectId);
    if (older && cursor) query.set('before', cursor);
    try {
      const page = await api<{ entries: Attempt[]; nextCursor: string | null }>(
        `/attempts?${query}`,
        undefined,
        'GET',
      );
      if (token !== generation.current) return;
      setEntries((prior) => (older ? [...prior, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    setEntries([]);
    setCursor(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [filter, scoped, projectId]);
  const live = new Map((data.attempts || []).map((attempt) => [attempt.id, attempt]));
  return (
    <section className="control-section">
      <h3>Recorded requests</h3>
      <p>
        {data.usage?.requests24h ?? 0} recorded requests in the last 24 hours. Cached documents do
        not count. Subscription allowance and unrelated provider-account spending are unavailable
        here. Acknowledgement permits retry; recorded usage remains.
      </p>
      <label>
        Receipt status
        <select
          aria-label="Receipt status"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="">All receipts</option>
          <option value="uncertain">Uncertain · needs acknowledgement</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="cached">Cached</option>
        </select>
      </label>
      {projectId && (
        <label className="check-row">
          <input
            type="checkbox"
            checked={scoped}
            onChange={(event) => setScoped(event.target.checked)}
          />
          Only this project
        </label>
      )}
      <button className="text-button" disabled={busy} onClick={() => load()}>
        Refresh receipts
      </button>
      {error && <p role="alert">{error}</p>}
      {!entries.length && !busy && <p>No matching requests recorded.</p>}
      <div className="usage-list">
        {entries.map((saved) => {
          const a = live.get(saved.id) || saved;
          return (
            <article key={a.id}>
              <strong>
                {PROVIDER_LABELS[a.provider]} · {a.phase} · {a.status}
              </strong>
              <span>
                {data.state.projects.find((project) => project.id === a.projectId)?.title ||
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
                      : `API estimate held: $${a.reservedUsd.toFixed(4)}${a.actualUsd != null ? ` · recorded estimate: $${a.actualUsd.toFixed(4)}` : ''}`}
                {a.inputTokens !== undefined
                  ? ` · input ${a.inputTokens}, output ${a.outputTokens ?? 'unknown'} tokens`
                  : ''}
              </p>
              {a.error && <p>{a.error}</p>}
              {a.status === 'uncertain' && (
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/attempts/${a.id}/acknowledge`);
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  Acknowledge uncertain usage
                </button>
              )}
            </article>
          );
        })}
      </div>
      {cursor && (
        <button className="button secondary" disabled={busy} onClick={() => load(true)}>
          Load older receipts
        </button>
      )}
    </section>
  );
}
