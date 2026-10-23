import type { ThreadEvent } from '@openai/codex-sdk';
import { CONSOLE_LIMITS, type ConsoleEvent } from '../shared/console.js';

export function consoleText(raw: string) {
  // Never read Codex auth files. Only redact known application secrets and common credential formats.
  let text = raw;
  for (const name of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'COMPATIBLE_API_KEY', 'RUNNER_TOKEN']) {
    const secret = process.env[name];
    if (secret && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  }
  text = text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-(?:proj-|svcacct-)?|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(
      /((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|runner_token)(?:["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}\n]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const truncated = text.length > CONSOLE_LIMITS.entryCharacters;
  if (truncated) {
    const marker =
      '\n\n[Console excerpt: middle omitted; this does not shorten the actual model request or result.]\n\n';
    const available = CONSOLE_LIMITS.entryCharacters - marker.length;
    text =
      text.slice(0, Math.floor(available * 0.6)) + marker + text.slice(-Math.ceil(available * 0.4));
  }
  return { text, truncated };
}

/** Forward only public SDK items. Reasoning and opaque tool payloads never enter the console. */
export function nativeConsole(onTrace?: (event: ConsoleEvent) => void, now = Date.now) {
  const last = new Map<string, number>();
  return (event: ThreadEvent) => {
    if (
      !onTrace ||
      !['item.started', 'item.updated', 'item.completed'].includes(event.type) ||
      !('item' in event)
    )
      return;
    const item = event.item;
    if (item.type === 'reasoning') {
      if (!last.has('model-activity')) {
        last.set('model-activity', now());
        onTrace({
          id: 'processing',
          type: 'status',
          text: 'Codex reported model activity. Private reasoning text is not included; public replies and tool results will appear as available.',
          status: 'processing',
        });
      }
      return;
    }
    if (!['agent_message', 'command_execution', 'file_change', 'web_search'].includes(item.type))
      return;
    const completed = event.type === 'item.completed';
    const time = now();
    if (!completed && last.has(item.id) && time - last.get(item.id)! < 200) return;
    last.set(item.id, time);
    if (item.type === 'agent_message' && item.text.trim())
      onTrace({
        id: `reply:${item.id}`,
        type: 'response',
        text: item.text,
        status: completed ? 'completed' : 'in_progress',
      });
    if (item.type === 'command_execution')
      onTrace({
        id: `command:${item.id}`,
        type: 'command',
        text: `$ ${item.command}\n${item.aggregated_output || ''}${item.exit_code === undefined ? '' : `\nExit code: ${item.exit_code}`}`,
        status: item.status,
      });
    if (item.type === 'file_change')
      onTrace({
        id: `files:${item.id}`,
        type: 'tool',
        text: item.changes.map((c) => `${c.kind}: ${c.path}`).join('\n'),
        status: item.status,
      });
    if (item.type === 'web_search')
      onTrace({
        id: `search:${item.id}`,
        type: 'tool',
        text: `Web search: ${item.query}`,
        status: completed ? 'completed' : 'in_progress',
      });
  };
}
