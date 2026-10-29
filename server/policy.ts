import { createHash, randomUUID } from 'node:crypto';
import type { Observation } from '../shared/verification.js';
import type { Attempt, CostPolicy, MemoryItem, Project, Provider, Task } from '../shared/types.js';
import type { Store } from './store.js';
import { defaultPolicy } from '../shared/schemas.js';
import type { ConsoleEvent } from '../shared/console.js';
import { saveResponseIssue } from './work-results.js';

export type GenerationContext = {
  store?: Store;
  project?: Project;
  task?: Task;
  phase?: 'plan' | 'task' | 'meeting';
  meetingId?: string;
  model?: string;
  onAttempt?: (id: string) => void;
  signal?: AbortSignal;
  workspace?: string;
  toolNetwork?: boolean;
  readOnly?: boolean;
  research?: boolean;
  onTool?: (entry: NonNullable<Task['toolLog']>[number]) => void;
  cache?: boolean;
  cacheWhen?: (text: string) => boolean;
  onContext?: () => void;
  onTrace?: (event: ConsoleEvent) => void;
  outputSchema?: Record<string, unknown>;
};
export type Generated = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  outputLimitReached?: boolean;
  observations?: Observation[];
};
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function billingFor(provider: Provider): Attempt['billing'] {
  return provider === 'codex'
    ? 'subscription'
    : provider === 'external'
      ? 'external'
      : provider === 'demo'
        ? 'none'
        : provider === 'ollama' ||
            (provider === 'compatible' && process.env.COMPATIBLE_BILLING === 'local')
          ? 'local'
          : 'api';
}
export function memoryCurrent(item: MemoryItem, tasks: Task[]) {
  if (!item.sourceTaskId) return true;
  const source = tasks.find((t) => t.id === item.sourceTaskId && t.projectId === item.projectId);
  return source?.status === 'done' && hash(source.output) === item.sourceHash;
}
export function selectedMemory(store: Store | undefined, projectId: string) {
  return (store?.state.memory || [])
    .filter(
      (m) =>
        m.projectId === projectId &&
        m.status === 'verified' &&
        memoryCurrent(m, store!.state.tasks),
    )
    .map((m) => ({
      id: m.id,
      sourceId: `memory:${m.id}`,
      content: m.content,
      sourceTaskId: m.sourceTaskId || 'Human supplied',
    }));
}
export function humanDirection(store: Store | undefined, projectId: string) {
  return (store?.state.approvals || [])
    .filter((a) => a.projectId === projectId && a.status !== 'pending' && a.feedback?.trim())
    .map((a) => ({
      sourceId: `approval:${a.id}`,
      sourceTaskId: a.taskId,
      title: a.question,
      decision: a.status,
      feedback: a.feedback,
    }));
}
export function relevantContext(task: Task, context: Task[]) {
  const final =
    task.documentKind === 'status_report' ||
    /hand[\s-]?off|bring it all together|results and next decisions|recommend a decision/i.test(
      task.title,
    );
  return context
    .filter((t) => final || task.dependencies.includes(t.id))
    .map((t) => ({
      sourceId: `task:${t.id}`,
      title: t.title,
      output: t.result
        ? `${JSON.stringify({ summary: t.result.summary, handoff: t.result.handoff, checks: t.result.checks })}\n\n${t.output}`
        : t.output,
    }));
}
export function policy(store?: Store): CostPolicy {
  return store?.state.policy || structuredClone(defaultPolicy);
}
export function reserve(
  store: Store,
  project: Project,
  provider: Provider,
  phase: 'plan' | 'task' | 'meeting',
  model: string,
  inputBytes: number,
  task?: Task,
  meetingId?: string,
): Attempt {
  const p = policy(store),
    all = store.attempts(),
    recent = all.filter((a) => a.status !== 'cached' && a.createdAt >= Date.now() - 86400000);
  if (inputBytes > p.maxInputBytes)
    throw new Error(
      'Input exceeds the configured context limit. Increase it in Workspace controls or reduce the assignment. No request was sent.',
    );
  if (recent.length >= p.maxRequests24h)
    throw new Error(
      'The request limit for the last 24 hours has been reached. No request was sent.',
    );
  if (all.filter((a) => a.status === 'running').length >= p.maxConcurrent)
    throw new Error('Another worker is active. Wait for it to finish.');
  if (task && all.some((a) => a.taskId === task.id && a.status === 'uncertain'))
    throw new Error(
      'An earlier attempt is uncertain. Acknowledge it in Usage before retrying; it may already have consumed usage.',
    );
  if (meetingId && all.some((a) => a.meetingId === meetingId && a.status === 'uncertain'))
    throw new Error('Acknowledge uncertain meeting usage in Workspace controls before retrying.');
  let reservedUsd = 0;
  if (
    provider === 'openai' ||
    provider === 'gemini' ||
    (provider === 'compatible' && process.env.COMPATIBLE_BILLING !== 'local')
  ) {
    if (!p.allowPaid)
      throw new Error(
        'Paid APIs are disabled. Enable them explicitly in Workspace controls before running this project.',
      );
    const rate = p.rates[provider as 'openai' | 'gemini' | 'compatible'];
    if (!rate || rate.model !== model)
      throw new Error(
        'Set a price estimate matching this project’s exact model in Workspace controls before using a paid API.',
      );
    // UTF-8 bytes plus protocol allowance deliberately overestimates text tokens.
    // This is an application estimate, not an account-wide provider billing cap.
    reservedUsd =
      Math.ceil(
        (inputBytes + 4096) * rate.inputPerMillion + p.maxOutputTokens * rate.outputPerMillion,
      ) / 1e6;
    const value = (a: Attempt) => a.actualUsd ?? a.reservedUsd;
    const daily = recent.reduce((sum, a) => sum + value(a), 0),
      projectCost = all
        .filter((a) => a.projectId === project.id)
        .reduce((sum, a) => sum + value(a), 0);
    if (daily + reservedUsd > p.dailyBudgetUsd || projectCost + reservedUsd > p.projectBudgetUsd)
      throw new Error(
        'The next request would exceed the workspace or project budget estimate. No request was sent.',
      );
  }
  const a: Attempt = {
    id: randomUUID(),
    projectId: project.id,
    taskId: task?.id,
    meetingId,
    provider,
    phase,
    status: 'running',
    createdAt: Date.now(),
    reservedUsd,
    model,
    billing: billingFor(provider),
  };
  store.putAttempt(a);
  return a;
}
export async function guarded(
  provider: Provider,
  system: string,
  user: string,
  ctx: GenerationContext,
  generate: () => Promise<Generated>,
): Promise<string> {
  const { store, project, task } = ctx,
    model = ctx.model || project?.model || '';
  const key = hash(
    JSON.stringify({
      version: 4,
      project: project?.id,
      provider,
      model,
      system,
      user,
      maxOutput: policy(store).maxOutputTokens,
      reasoningEffort: project?.reasoningEffort || 'medium',
      outputSchema: ctx.outputSchema,
    }),
  );
  const cached = ctx.cache === false ? undefined : store?.cached(key);
  if (cached !== undefined && project) {
    const receipt: Attempt = {
      id: randomUUID(),
      projectId: project.id,
      taskId: task?.id,
      provider,
      phase: ctx.phase || 'task',
      status: 'cached',
      createdAt: Date.now(),
      reservedUsd: 0,
      model,
      billing: billingFor(provider),
    };
    store!.putAttempt(receipt);
    ctx.onAttempt?.(receipt.id);
    ctx.onTrace?.({
      type: 'status',
      text: 'Reusing a confirmed cached response. No model request was sent.',
      status: 'cached',
    });
    ctx.onTrace?.({ id: 'reply:cached', type: 'response', text: cached, status: 'cached' });
    return cached;
  }
  const attempt =
    store && project
      ? reserve(
          store,
          project,
          provider,
          ctx.phase || 'task',
          model,
          Buffer.byteLength(system + user, 'utf8'),
          task,
          ctx.meetingId,
        )
      : undefined;
  if (attempt) ctx.onAttempt?.(attempt.id);
  ctx.onTrace?.({
    id: 'request',
    type: 'request',
    text: `Workroom instructions:\n${system}\n\nAssignment and selected context:\n${user}`,
    status: 'dispatching',
  });
  // Keep the dispatch quote even if settings are edited while a request is running.
  const rate =
    billingFor(provider) === 'api'
      ? structuredClone(policy(store).rates[provider as 'openai' | 'gemini' | 'compatible'])
      : undefined;
  let completionConfirmed = false;
  try {
    const result = await generate();
    if (provider !== 'codex')
      ctx.onTrace?.({ id: 'result', type: 'response', text: result.text, status: 'completed' });
    if (attempt && store) {
      const usageKnown =
        Number.isFinite(result.inputTokens) &&
        Number.isFinite(result.outputTokens) &&
        result.inputTokens! >= 0 &&
        result.outputTokens! >= 0;
      const actual =
        rate && usageKnown
          ? (result.inputTokens! * rate.inputPerMillion +
              result.outputTokens! * rate.outputPerMillion) /
            1e6
          : undefined;
      store.completeAttempt(
        {
          ...attempt,
          status: 'completed',
          actualUsd: actual,
          inputTokens: usageKnown ? result.inputTokens : undefined,
          outputTokens: usageKnown ? result.outputTokens : undefined,
        },
        {
          text: result.text.slice(0, 200000),
          outputLimitReached: result.outputLimitReached || result.text.length > 200000,
          observations: result.observations,
        },
      );
    }
    completionConfirmed = true;
    if (task && result.observations) task.observations = result.observations;
    if (result.outputLimitReached) {
      const message =
        'The model reached the configured output token limit before finishing its response. Open Workspace controls → Maximum output tokens and raise it within your budget, or request a smaller deliverable, then retry. The partial reply is saved; no automatic retry or API fallback was attempted.';
      saveResponseIssue(task, result.text, [message]);
      ctx.onContext?.();
      throw new Error(message);
    }
    if (!result.text.trim()) throw new Error('The model returned no document.');
    if (result.text.length > 200000)
      throw new Error('The model response exceeds the document limit.');
    if (store && attempt && ctx.cache !== false && (!ctx.cacheWhen || ctx.cacheWhen(result.text)))
      store.cache(key, result.text);
    ctx.onTrace?.({
      type: 'status',
      text: `Model request completed${result.inputTokens === undefined ? '' : ` · input tokens: ${result.inputTokens}`}${result.outputTokens === undefined ? '' : ` · output tokens: ${result.outputTokens}`}. Completion of a model request is separate from acceptance of the work.`,
      status: 'completed',
    });
    return result.text;
  } catch (error) {
    ctx.onTrace?.({
      type: 'error',
      text: error instanceof Error ? error.message : 'The model request failed.',
      status: ctx.signal?.aborted ? 'cancelled' : 'failed',
    });
    if (attempt && store && !completionConfirmed)
      store.putAttempt({
        ...attempt,
        status: 'uncertain',
        error:
          'No confirmed completion receipt. Review before retrying; usage may have been consumed.',
      });
    throw error;
  }
}
