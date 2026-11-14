import type { Bootstrap } from '../shared/types';
export class ApiError extends Error {
  constructor(
    message: string,
    public action?: string,
  ) {
    super(message);
  }
}
let session: Promise<string> | undefined;
let pairingKey = '';
export class PairingRequired extends Error {}
export function setBrowserKey(value: string) {
  pairingKey = value.trim();
  try {
    sessionStorage.setItem('workroom-browser-key', pairingKey);
  } catch {
    /* The paired cookie still works without browser storage. */
  }
  session = undefined;
}
try {
  pairingKey = sessionStorage.getItem('workroom-browser-key') || '';
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('workroom-key')) {
    setBrowserKey(fragment.get('workroom-key') || '');
    history.replaceState(null, '', location.pathname + location.search);
  }
} catch {
  /* Browser storage can be unavailable. */
}
function browserToken(refresh = false) {
  if (refresh) session = undefined;
  return (session ||= fetch('/api/session', {
    cache: 'no-store',
    headers: pairingKey ? { Authorization: `Bearer ${pairingKey}` } : {},
  })
    .then(async (response) => {
      if (response.status === 401)
        throw new PairingRequired(
          'Connect this browser using the private link in the Workroom terminal.',
        );
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
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Workroom-CSRF': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (response.status === 401 && data.code === 'BROWSER_PAIRING_REQUIRED' && !refresh)
      return send(true);
    if (response.status === 403 && data.code === 'SESSION_REQUIRED' && !refresh) return send(true);
    if (!response.ok)
      throw new ApiError(data.error || `Request failed (${response.status}).`, data.action);
    return data as T;
  };
  return send();
}
export async function getState(): Promise<Bootstrap> {
  return api<Bootstrap>('/state', undefined, 'GET');
}
export async function streamApi(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  for (const refresh of [false, true]) {
    const token = await browserToken(refresh);
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'X-Workroom-CSRF': token },
      body: JSON.stringify(body),
    });
    if (response.ok) return response;
    const data = await response.json();
    if (
      !refresh &&
      ((response.status === 401 && data.code === 'BROWSER_PAIRING_REQUIRED') ||
        (response.status === 403 && data.code === 'SESSION_REQUIRED'))
    )
      continue;
    throw new ApiError(data.error || `Request failed (${response.status}).`);
  }
  throw new Error('Refresh the browser session before sending a message.');
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
