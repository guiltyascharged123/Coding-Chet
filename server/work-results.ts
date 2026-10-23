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
