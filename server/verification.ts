import type { Task } from '../shared/types.js';
import type { Observation } from '../shared/verification.js';
import type { WorkResult } from '../shared/work.js';

export function reportedAcceptanceGaps(
  task: Pick<Task, 'acceptanceCriteria'> | undefined,
  result: WorkResult,
) {
  return (task?.acceptanceCriteria || [])
    .filter(
      (criterion) =>
        !result.checks.some(
          (check) => check.criterion.startsWith(`${criterion.id}:`) && check.status === 'met',
        ),
    )
    .map(
      (criterion) =>
        `Acceptance ${criterion.id} must have a met check prefixed “${criterion.id}:”.`,
    );
}

export function commandKind(command: string): 'verification' | 'inspection' | undefined {
  // Recognize an actual invocation, not a quoted claim such as echo "npm test".
  const unwrapped = command.replace(
    /^(?:\/\S+\/)?(?:bash|sh|zsh)\s+-[lc]+\s+(['"])([\s\S]*)\1$/,
    '$2',
  );
  // Masked failures, pipelines and substitutions cannot establish that the
  // verification itself succeeded from the shell's final exit code.
  if (/[;|\n`]|\$\(/.test(unwrapped)) return undefined;
  const steps = unwrapped.split('&&').map((s) => s.trim());
  if (
    steps.some((s) =>
      /^(?:npm|pnpm|yarn)\s+(?:test\b|run\s+(?:test|build|lint|typecheck|check)\b)|^(?:npx\s+)?(?:tsc\b|vitest\b|jest\b|playwright\s+test\b)|^node\s+--test\b|^(?:python[\d.]*\s+-m\s+)?pytest\b|^(?:cargo|go|dotnet)\s+test\b|^python[\d.]*\s+-m\s+unittest\b/.test(
        s,
      ),
    )
  )
    return 'verification';
  if (
    steps.some((s) => /^(?:cat|head|tail|sed|rg|grep|find)\s+\S|^git\s+(?:diff|show|log)\b/.test(s))
  )
    return 'inspection';
  return undefined;
}

export function evidenceGaps(
  task: Pick<Task, 'workType' | 'acceptanceCriteria'> | undefined,
  observations: Observation[],
  result?: WorkResult,
) {
  const gaps: string[] = [];
  const has = (kind: Observation['kind']) => observations.some((o) => o.kind === kind);
  if (!observations.length && task?.workType !== 'plan')
    gaps.push('No substantive file inspection, file change or verification command was observed.');
  if (task?.workType === 'implementation' && (!has('artifact') || !has('verification')))
    gaps.push(
      'Implementation requires observed file changes and a successful verification command.',
    );
  if (task?.workType === 'tests' && !has('verification'))
    gaps.push('Testing requires a successful verification command.');
  if (task?.workType === 'review' && !has('inspection'))
    gaps.push('Review requires independent file inspection.');
  if (result) gaps.push(...reportedAcceptanceGaps(task, result));
  for (const criterion of task?.acceptanceCriteria || []) {
    const check = result?.checks.find((c) => c.criterion.startsWith(`${criterion.id}:`));
    if (!check || check.status !== 'met') continue;
    if (
      criterion.evidence !== 'report' &&
      !observations.some(
        (o) => o.kind === criterion.evidence && check.evidence.includes(o.reference),
      )
    )
      gaps.push(
        `Acceptance ${criterion.id} must cite an observed ${criterion.evidence} path or exact command in its evidence.`,
      );
  }
  return gaps;
}
