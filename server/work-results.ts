import type { Task } from '../shared/types.js';
import { consoleText } from './console.js';

export function jsonValue(output: string): unknown {
  const text = output.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Remove only blank optional handoff bullets, never findings or assignments.
 * The original reply remains unchanged in the console and request checkpoint.
 */
export function normalizeWorkReply(value: unknown, compact = false) {
  const notes: string[] = [];
  if (
    compact &&
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'outcome' in value &&
    value.outcome !== 'retrieve'
  ) {
    const record = { ...value } as Record<string, unknown>;
    if (
      record.summary === undefined &&
      typeof record.deliverable === 'string' &&
      record.deliverable.trim()
    ) {
      record.summary = record.deliverable.trim().slice(0, 1200);
      notes.push(
        'Compact local reply: summary is a verbatim deliverable excerpt, not a new model claim. Original reply retained.',
      );
    }
    if (record.handoff === undefined) {
      record.handoff = { facts: [], assumptions: [], next: 'No additional handoff supplied.' };
      notes.push(
        'Compact local reply: omitted handoff has no asserted facts or assumptions. Original reply retained.',
      );
    }
    value = record;
  }
  if (!value || typeof value !== 'object' || !('handoff' in value)) return { value, notes };
  const handoff = value.handoff;
  if (!handoff || typeof handoff !== 'object') return { value, notes };
  const cleaned = { ...handoff } as Record<string, unknown>;
  for (const key of ['facts', 'assumptions']) {
    const items = cleaned[key];
    if (!Array.isArray(items)) continue;
    const kept = items.filter((item) => typeof item !== 'string' || !!item.trim());
    if (kept.length !== items.length) {
      cleaned[key] = kept;
      notes.push(
        `Removed ${items.length - kept.length} empty optional handoff.${key} bullet(s). No substantive text or assignments changed; the original provider reply is retained.`,
      );
    }
  }
  return { value: { ...value, handoff: cleaned }, notes };
}

export function saveResponseIssue(task: Task | undefined, output: string, issues: string[]) {
  const response = consoleText(output);
  const saved = {
    receivedAt: Date.now(),
    issues: issues.slice(0, 8).map((issue) => consoleText(issue).text.slice(0, 500)),
    response: response.text,
    truncated: response.truncated,
  };
  if (task) task.responseIssue = saved;
  return saved;
}
