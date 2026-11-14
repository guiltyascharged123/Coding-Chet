import type { Task } from '../shared/types.js';
import type { WorkResult } from '../shared/work.js';
import { workResultSchema } from '../shared/work.js';
import { validationMessages } from '../shared/validation.js';
import { evidenceGaps } from './verification.js';
import { jsonValue, normalizeWorkReply } from './work-results.js';

/** Recovery is text-only: the callback must never redispatch the tool job.
 * Observations are captured before correction so generated claims cannot add receipts.
 */
export async function nativeResult(
  output: string,
  task: Pick<Task, 'workType' | 'acceptanceCriteria' | 'observations'>,
  correctionLimit: number,
  correct: (rejected: string, issues: string[]) => Promise<string>,
  rejected: (output: string, issues: string[]) => void,
): Promise<WorkResult> {
  const observations = structuredClone(task.observations || []);
  for (let round = 0; ; round++) {
    const value = normalizeWorkReply(jsonValue(output)).value;
    const parsed = workResultSchema.safeParse(value);
    if (parsed.success) {
      const result = parsed.data;
      const gaps = evidenceGaps(task, observations, result);
      if (result.outcome === 'complete' && gaps.length) {
        result.outcome = 'blocked';
        result.summary = ('This project assignment has not been verified. ' + gaps.join(' ')).slice(
          0,
          1200,
        );
        result.checks = [
          ...result.checks.slice(0, 11),
          {
            criterion: 'Observed acceptance evidence',
            status: 'not_met',
            evidence: gaps.join(' ').slice(0, 600),
          },
        ];
      }
      return result;
    }
    const issues =
      value === undefined
        ? ['response: Expected one complete JSON object; received malformed JSON or plain text.']
        : validationMessages(parsed.error, value, 'response');
    rejected(output, issues);
    if (round >= correctionLimit)
      throw new Error(
        `Codex returned an inconsistent work result: ${issues.slice(0, 3).join('; ')}. Open the task's saved response details. Files and confirmed usage were retained; code work was not automatically repeated.`,
      );
    output = await correct(output, issues);
  }
}
