import type { RequestHandler } from 'express';
import { z } from 'zod';
import { localGenerate, serviceUrl } from './managed.js';
import { DEFAULT_LOCAL_MODEL } from '../shared/defaults.js';

export const chatRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(150),
    messages: z
      .array(
        z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(12000) }),
      )
      .min(1)
      .max(30),
  })
  .superRefine((value, ctx) => {
    if (Buffer.byteLength(JSON.stringify(value.messages)) > 24000)
      ctx.addIssue({
        code: 'custom',
        message: 'Conversation is too long. Start a new chat or send a shorter message.',
      });
    if (
      value.messages.some(
        (message, index) => message.role !== (index % 2 ? 'assistant' : 'user'),
      ) ||
      value.messages.at(-1)?.role !== 'user'
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Conversation must alternate user and assistant messages and end with your message.',
      });
  });

/** Direct chat is local-only and does not create agent tasks or grant tools. */
export function localChatRoute(): RequestHandler {
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
        res.status(409).json({
          error: 'A local chat reply is already running. Stop it or wait for completion.',
        });
        return;
      }
      active = true;
      acquired = true;
      res.on('close', close);
      const endpoint = serviceUrl(process.env.OLLAMA_URL || 'http://127.0.0.1:11434', true);
      const response = await fetch(new URL('/api/tags', endpoint), {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok)
        throw new Error('Ollama model list is unavailable. Check the local server.');
      const tags = (await response.json()) as { models?: { name?: string; model?: string }[] };
      const { model, messages } = parsed.data;
      if (!tags.models?.some((entry) => (entry.name || entry.model) === model)) {
        res.status(400).json({
          error: `Exact model ${model} is not installed. Pull it with Ollama first. The default is ${DEFAULT_LOCAL_MODEL}.`,
        });
        return;
      }
      res.status(200).setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const send = (value: unknown) => {
        if (!res.destroyed) res.write(JSON.stringify(value) + '\n');
      };
      const system =
        'You are a helpful local assistant. Answer the user directly. Distinguish facts from assumptions. You have no file, shell or browsing tools in this chat; do not pretend to take external actions. Use the conversation as context.';
      const result = await localGenerate(
        system,
        JSON.stringify(messages),
        model,
        2000,
        controller.signal,
        false,
        undefined,
        {
          contextTokens: 16384,
          messages: [{ role: 'system', content: system }, ...messages],
          onTrace: (event) => {
            if (event.type === 'response') send({ type: 'text', text: event.text });
          },
        },
      );
      send({
        type: 'done',
        text: result.text,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        outputLimitReached: result.outputLimitReached,
      });
      res.end();
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed)
          res.end(
            JSON.stringify({
              type: 'error',
              error: controller.signal.aborted
                ? 'Reply stopped.'
                : error instanceof Error
                  ? error.message
                  : 'Local model request failed.',
            }) + '\n',
          );
      } else next(error);
    } finally {
      res.off('close', close);
      if (acquired) active = false;
    }
  };
}
