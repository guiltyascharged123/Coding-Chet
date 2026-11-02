import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useHistory<
  T extends { id: string; projectId: string; createdAt: number; updatedAt?: number },
>(path: string, recent: T[]) {
  const [state, setState] = useState({
    path,
    entries: [] as T[],
    cursor: null as string | null,
    busy: false,
    error: '',
  });
  const generation = useRef(0);
  const openedAt = useRef(Date.now());
  async function load(older = false) {
    const token = ++generation.current;
    setState((prior) => ({ ...prior, busy: true, error: '' }));
    try {
      const page = await api<{ entries: T[]; nextCursor: string | null }>(
        path + (older && state.cursor ? `?before=${encodeURIComponent(state.cursor)}` : ''),
        undefined,
        'GET',
      );
      if (token !== generation.current) return;
      setState((prior) => ({
        path,
        entries: older ? [...prior.entries, ...page.entries] : page.entries,
        cursor: page.nextCursor,
        busy: false,
        error: '',
      }));
    } catch (error) {
      if (token === generation.current)
        setState((prior) => ({ ...prior, busy: false, error: (error as Error).message }));
    }
  }
  useEffect(() => {
    openedAt.current = Date.now();
    setState({ path, entries: [], cursor: null, busy: false, error: '' });
    void load();
    return () => {
      generation.current++;
    };
  }, [path]);
  const merged = new Map(
    (state.path === path ? state.entries : []).map((entry) => [entry.id, entry]),
  );
  for (const entry of recent) {
    const previous = merged.get(entry.id);
    if (
      !previous &&
      (state.path !== path || (entry.updatedAt || entry.createdAt) < openedAt.current)
    )
      continue;
    if (
      !previous ||
      (entry.updatedAt || entry.createdAt) >= (previous.updatedAt || previous.createdAt)
    )
      merged.set(entry.id, entry);
  }
  return {
    entries: [...merged.values()].sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    ),
    more: state.path === path && !!state.cursor,
    busy: state.busy,
    error: state.error,
    loadOlder: () => load(true),
    refresh: () => load(false),
  };
}
