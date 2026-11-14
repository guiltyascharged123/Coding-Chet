import './network.js';
import type { RequestHandler } from 'express';
import {
  COMMUNITY_API_URL,
  COMMUNITY_ANONYMOUS_KEY,
  COMMUNITY_EXAMPLE_MODEL,
} from '../shared/community.js';
import { chatRequestSchema } from './local-chat.js';

export async function communityModels(signal?: AbortSignal) {
  const response = await fetch(`${COMMUNITY_API_URL}/models`, {
    headers: { Authorization: `Bearer ${COMMUNITY_ANONYMOUS_KEY}` },
    signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok)
    throw new Error('The free community model list is unavailable. No paid service was used.');
  const body = (await response.json()) as {
    data?: { id?: string; top_provider?: { max_completion_tokens?: number } }[];
  };
  if (!Array.isArray(body.data))
    throw new Error('The community service did not return a model list.');
  return body.data
    .filter((entry) => typeof entry.id === 'string' && entry.id.length <= 150)
    .map((entry) => ({
      id: entry.id!,
      maxTokens: Math.max(16, Math.min(2000, entry.top_provider?.max_completion_tokens || 2000)),
    }));
}

export const communityModelsRoute: RequestHandler = async (_req, res, next) => {
  try {
    const entries = await communityModels(),
      models = entries.map((entry) => entry.id);
    const preferred = models.includes(COMMUNITY_EXAMPLE_MODEL)
      ? COMMUNITY_EXAMPLE_MODEL
      : models.find((id) => /abliterat|heretic|uncensored/i.test(id)) || models[0] || '';
    res.json({ models, preferred });
  } catch (error) {
    next(error);
  }
};

/** Explicit opt-in public volunteer inference. Never uses a personal key,
 * arbitrary URL, paid endpoint, private project state or automatic fallback.
 */
export function communityChatRoute(): RequestHandler {
  let active = false;
  return async (req, res, next) => {
    const controller = new AbortController();
    let acquired = false;
    const close = () => {
      if (!res.writableEnded) controller.abort();
    };
    try {
      const parsed = chatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0].message });
        return;
      }
      if (active) {
        res
          .status(409)
          .json({ error: 'A community reply is already pending. Stop waiting or let it finish.' });
        return;
      }
      active = true;
      acquired = true;
      res.on('close', close);
      const { model, messages } = parsed.data;
      const selected = (await communityModels(controller.signal)).find(
        (entry) => entry.id === model,
      );
      if (!selected) {
        res.status(400).json({
          error:
            'The exact model is not currently advertised by the community service. Refresh the model list; no substitute was selected.',
        });
        return;
      }
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const response = await fetch(`${COMMUNITY_API_URL}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(900000)]),
        headers: {
          Authorization: `Bearer ${COMMUNITY_ANONYMOUS_KEY}`,
          'Content-Type': 'application/json',
          'Client-Agent': 'Workroom:0.1.0:https://github.com/guiltyascharged123/Coding-Chet',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'Answer the user accurately using the conversation. Separate supplied facts, hypotheses and proposed actions. You have no file, shell or web tools in this chat. Do not invent completed actions or measurements.',
            },
            ...messages,
          ],
          max_tokens: selected.maxTokens,
          stream: false,
        }),
      });
      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        throw new Error(
          `The community service returned HTTP ${response.status}. Its model may be busy or unavailable.${retry ? ` Retry after ${retry} seconds.` : ''} No other provider was used.`,
        );
      }
      const body = (await response.json()) as {
        model?: string;
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (body.model !== model)
        throw new Error('The community service did not confirm the exact requested model.');
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim())
        throw new Error('The community worker returned no public answer.');
      if (text.length > 100000)
        throw new Error('The community answer exceeds the saved chat limit.');
      if (!res.destroyed)
        res.end(
          JSON.stringify({
            type: 'done',
            text,
            model,
            inputTokens: body.usage?.prompt_tokens,
            outputTokens: body.usage?.completion_tokens,
            outputLimitReached: body.choices?.[0]?.finish_reason === 'length',
          }) + '\n',
        );
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed)
          res.end(
            JSON.stringify({
              type: 'error',
              error: controller.signal.aborted
                ? 'Stopped waiting for the community reply.'
                : error instanceof Error
                  ? error.message
                  : 'Community request failed.',
            }) + '\n',
          );
      } else next(error);
    } finally {
      res.off('close', close);
      if (acquired) active = false;
    }
  };
}
