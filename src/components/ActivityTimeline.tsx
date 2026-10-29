import { useEffect, useState, type ReactNode } from 'react';
import type { Activity } from '../../shared/types';
import { api } from '../api';

type Page = { entries: Activity[]; nextCursor: number | null };
export default function ActivityTimeline({
  projectId,
  filter,
  recent,
  render,
}: {
  projectId: string;
  filter: string;
  recent: Activity[];
  render: (activity: Activity) => ReactNode;
}) {
  const [history, setHistory] = useState<Page>({ entries: [], nextCursor: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const query = filter === 'all' ? '' : `type=${encodeURIComponent(filter)}`;
  useEffect(() => {
    let disposed = false;
    api<Page>(`/projects/${projectId}/activity?${query}`, undefined, 'GET')
      .then((page) => {
        if (!disposed) setHistory(page);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [projectId, query]);
  // Keep events observed while this timeline is open even after the recent
  // workspace window advances. Pagination still starts at the original cursor.
  const latestId = recent[0]?.id;
  useEffect(() => {
    if (!latestId) return;
    setHistory((current) =>
      current.entries.length
        ? {
            ...current,
            entries: [
              ...new Map(
                [
                  ...current.entries,
                  ...recent.filter((a) => a.createdAt >= current.entries[0].createdAt),
                ].map((a) => [a.id, a]),
              ).values(),
            ].sort((a, b) => b.createdAt - a.createdAt),
          }
        : current,
    );
  }, [latestId]);
  const newEvents = history.entries.length
    ? recent.filter((a) => a.createdAt >= history.entries[0].createdAt)
    : recent.slice(0, 100);
  const entries = [
    ...new Map(
      [...history.entries, ...newEvents]
        .filter((a) => filter === 'all' || a.type === filter)
        .map((a) => [a.id, a]),
    ).values(),
  ].sort((a, b) => b.createdAt - a.createdAt);
  async function more() {
    setBusy(true);
    setError('');
    try {
      const page = await api<Page>(
        `/projects/${projectId}/activity?${query}${history.nextCursor ? `&before=${history.nextCursor}` : ''}`,
        undefined,
        'GET',
      );
      setHistory((current) => ({
        entries: [...current.entries, ...page.entries],
        nextCursor: page.nextCursor,
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="field-hint">
        Recent updates load first. Older events remain saved and are included in workspace backups.
      </p>
      <div className="activity-list">{entries.map(render)}</div>
      {!entries.length && !busy && !error && <p>No matching activity yet.</p>}
      {error && <p role="alert">{error}</p>}
      {(history.nextCursor || error) && (
        <button className="button secondary" disabled={busy} onClick={more}>
          {busy ? 'Loading history…' : error ? 'Retry loading history' : 'Load older activity'}
        </button>
      )}
      {busy && <p role="status">Loading activity…</p>}
    </>
  );
}
