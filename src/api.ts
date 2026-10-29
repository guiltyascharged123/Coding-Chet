import type { Bootstrap } from '../shared/types';
let session: Promise<string> | undefined;
function browserToken(refresh = false) {
  if (refresh) session = undefined;
  return (session ||= fetch('/api/session', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok)
        throw new Error('The browser session could not connect. Refresh and try again.');
      return (await response.json()).token as string;
    })
    .catch((error) => {
      session = undefined;
      throw error;
    }));
}
export async function api<T = { ok: boolean }>(
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<T> {
  const send = async (refresh = false): Promise<T> => {
    const token = await browserToken(refresh);
    const response = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Workroom-CSRF': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (response.status === 403 && data.code === 'SESSION_REQUIRED' && !refresh) return send(true);
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data as T;
  };
  return send();
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
