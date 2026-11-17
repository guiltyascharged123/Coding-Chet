import type { Task } from './types.js';

/** A model-reported blocker is different from a transport/format failure.
 * Do not relabel a later failure using an old result retained across retries.
 */
export function isReportedBlocker(task: Pick<Task, 'status' | 'result' | 'error'>) {
  return (
    task.status === 'failed' &&
    task.result?.outcome === 'blocked' &&
    task.error === task.result.summary
  );
}
