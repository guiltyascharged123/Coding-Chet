import { consoleText } from './console.js';

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public rejectedBeforeInference = false,
    public freeOutputLimit?: number,
    public retryAfterMs = 0,
  ) {
    super(message);
  }
}

/** Read bounded diagnostics, never an unlimited proxy page or raw credentials. */
export async function providerResponseError(response: Response, label: string, community = false) {
  const reader = response.body?.getReader(),
    decoder = new TextDecoder();
  let body = '',
    bytes = 0;
  if (reader)
    try {
      while (bytes < 16384) {
        const { value, done } = await reader.read();
        if (done) break;
        const n = Math.min(value.length, 16384 - bytes);
        body += decoder.decode(value.subarray(0, n), { stream: true });
        bytes += n;
      }
      body += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {}
  const error = data?.error;
  const raw =
    typeof error?.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof data?.message === 'string'
          ? data.message
          : '';
  const code =
    typeof error?.code === 'string'
      ? error.code
      : typeof error?.metadata?.rc === 'string'
        ? error.metadata.rc
        : undefined;
  const kudos = community && response.status === 403 && code === 'KudosUpfront';
  const match = kudos
    ? raw.match(/serve up to\s+([\d,]+)\s+tokens without kudos held upfront/i)
    : null;
  const limit = match ? Number(match[1].replaceAll(',', '')) : undefined;
  const retry = response.headers.get('Retry-After');
  const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : undefined;
  const retryMs =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : retry && Number.isFinite(Date.parse(retry))
        ? Math.max(0, Date.parse(retry) - Date.now())
        : typeof error?.metadata?.retry_after === 'number' &&
            Number.isFinite(error.metadata.retry_after) &&
            error.metadata.retry_after >= 0
          ? error.metadata.retry_after * 1000
          : 0;
  const detail = raw
    ? consoleText(raw).text.slice(0, 1200)
    : /<html|<!doctype/i.test(body)
      ? 'The service returned an HTML access/proxy error page.'
      : 'No structured error details were provided.';
  const advice = kudos
    ? 'Anonymous AI Horde access has a provider-imposed kudos/capacity restriction. Reduce the requested output or input, or explicitly choose another connection.'
    : community
      ? 'Check AI Horde availability and its anonymous-access limits.'
      : 'Check the server key, model access and quota.';
  const publicCode = code ? consoleText(code).text.slice(0, 80) : undefined;
  return new ProviderRequestError(
    `${label} returned HTTP ${response.status}${publicCode ? ` (${publicCode})` : ''}. ${detail} ${advice}${retryMs > 0 ? ` The service requested a ${Math.ceil(retryMs / 1000)}-second wait.` : ''}`,
    response.status,
    publicCode,
    kudos,
    Number.isSafeInteger(limit) && limit! > 0 ? limit : undefined,
    retryMs,
  );
}
