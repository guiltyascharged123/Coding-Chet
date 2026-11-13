import type { ConsoleEntry } from '../shared/console';

/** Streaming text stays verbatim. Completed JSON is indented, never summarized:
 * outcome, handoffs, decisions, failed fields and unknown fields remain visible.
 */
export function consoleReplyText(entry: ConsoleEntry, raw: boolean) {
  if (raw || entry.type !== 'response' || entry.status === 'in_progress') return entry.text;
  try {
    return JSON.stringify(JSON.parse(entry.text), null, 2);
  } catch {
    return entry.text;
  }
}
