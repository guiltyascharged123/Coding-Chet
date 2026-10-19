import type { Bootstrap } from '../shared/types';
export async function api<T = { ok: boolean }>(
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}
export async function getState(): Promise<Bootstrap> {
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('The runtime is unavailable. Start the server and try again.');
  return response.json();
}
export function relativeTime(time: number) {
  const secs = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return secs < 60
    ? 'just now'
    : secs < 3600
      ? `${Math.floor(secs / 60)}m ago`
      : new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function download(name: string, content: string) {
  saveBlob(name, new Blob([content], { type: 'text/markdown;charset=utf-8' }));
}
export function saveBlob(name: string, content: Blob) {
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
