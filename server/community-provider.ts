import './network.js';
import { COMMUNITY_ANONYMOUS_KEY, isCommunityEndpoint } from '../shared/community.js';
import { setTimeout as delay } from 'node:timers/promises';
import { providerResponseError, type ProviderRequestError } from './provider-errors.js';

export function communityConnection() {
  if (process.env.COMPATIBLE_BILLING !== 'community') return false;
  if (!isCommunityEndpoint(process.env.COMPATIBLE_API_URL || ''))
    throw new Error(
      'Free community mode requires the exact AI Horde HTTPS endpoint. Other remote services require API spending controls.',
    );
  return true;
}
export function compatibleKey() {
  // Never forward a previously configured provider's private key to volunteers.
  return communityConnection()
    ? COMMUNITY_ANONYMOUS_KEY
    : process.env.COMPATIBLE_API_KEY || 'local';
}

/** Only an explicit, pre-inference KudosUpfront rejection permits one smaller
 * anonymous request. No generic 403, rate-limit or transport retries/fallbacks. */
export async function communityCompletion(
  body: Record<string, unknown> & { max_tokens: number },
  signal: AbortSignal,
  advertisedLimit?: number,
  onLimit?: (tokens: number, reason: string) => void,
) {
  let tokens = body.max_tokens;
  let lastRejection: ProviderRequestError | undefined;
  if (Number.isSafeInteger(advertisedLimit) && advertisedLimit! > 0 && advertisedLimit! < tokens) {
    tokens = advertisedLimit!;
    onLimit?.(tokens, 'the model’s advertised output ceiling');
  }
  for (let round = 0; round < 2; round++) {
    if (signal.aborted && lastRejection) throw lastRejection;
    signal.throwIfAborted();
    const response = await fetch('https://oai.aihorde.net/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${COMMUNITY_ANONYMOUS_KEY}`,
        'Content-Type': 'application/json',
        'Client-Agent': 'Workroom:0.1.0:https://github.com/guiltyascharged123/Coding-Chet',
      },
      body: JSON.stringify({ ...body, max_tokens: tokens }),
    });
    if (response.ok) return response;
    const error = await providerResponseError(response, 'AI Horde', true);
    if (
      round === 0 &&
      error.rejectedBeforeInference &&
      error.freeOutputLimit &&
      error.freeOutputLimit < tokens &&
      error.retryAfterMs <= 60000
    ) {
      tokens = error.freeOutputLimit;
      lastRejection = error;
      onLimit?.(
        tokens,
        'the service’s explicit no-upfront-kudos allowance; the larger request was rejected before inference',
      );
      if (error.retryAfterMs)
        try {
          await delay(error.retryAfterMs, undefined, { signal });
        } catch (cause) {
          if (signal.aborted) throw error;
          throw cause;
        }
      continue;
    }
    throw error;
  }
  throw new Error('AI Horde did not accept the bounded anonymous request.');
}
