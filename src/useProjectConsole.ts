import { useEffect, useState } from 'react';
import type { ConsoleEntry } from '../shared/console';

/** One bounded public-output stream. Switching projects never exposes the previous team's log. */
export function useProjectConsole(projectId?: string, reconnect = 0) {
  const [state, setState] = useState({
    projectId,
    entries: [] as ConsoleEntry[],
    connected: false,
    message: '',
  });
  useEffect(() => {
    setState({ projectId, entries: [], connected: false, message: '' });
    if (!projectId) return;
    let disposed = false;
    const source = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/console/events`);
    const change = (update: (prior: typeof state) => typeof state) => {
      if (!disposed) setState(update);
    };
    source.addEventListener('snapshot', (event) => {
      try {
        const entries = (JSON.parse(event.data).entries as ConsoleEntry[]).filter(
          (entry) => entry.projectId === projectId,
        );
        change((prior) => ({ ...prior, entries }));
      } catch {
        change((prior) => ({
          ...prior,
          message: 'Console history could not be read. Reconnect to reload it.',
        }));
      }
    });
    source.addEventListener('update', (event) => {
      try {
        const { entry, removed } = JSON.parse(event.data) as {
          entry?: ConsoleEntry;
          removed: string[];
        };
        change((prior) => {
          const entries = prior.entries.filter((e) => !removed.includes(e.id));
          if (entry?.projectId === projectId) {
            const existing = entries.find((e) => e.id === entry.id);
            if (!existing || existing.sequence < entry.sequence) {
              return {
                ...prior,
                entries: [...entries.filter((e) => e.id !== entry.id), entry].sort(
                  (a, b) => a.sequence - b.sequence,
                ),
              };
            }
          }
          return { ...prior, entries };
        });
      } catch {
        change((prior) => ({
          ...prior,
          message: 'A console update could not be read. Reconnect to reload history.',
        }));
      }
    });
    source.addEventListener('warning', (event) => {
      let message = 'Console history could not be saved.';
      try {
        message = JSON.parse(event.data).message;
      } catch {
        /* Use a readable fallback. */
      }
      change((prior) => ({ ...prior, message }));
    });
    source.onopen = () => change((prior) => ({ ...prior, connected: true, message: '' }));
    source.onerror = () => change((prior) => ({ ...prior, connected: false }));
    return () => {
      disposed = true;
      source.close();
    };
  }, [projectId, reconnect]);
  return state.projectId === projectId
    ? state
    : { projectId, entries: [], connected: false, message: '' };
}
