import { RESOURCE_LIMITS } from '../shared/limits.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Observation } from '../shared/verification.js';
import type { Attempt, CostPolicy, MemoryItem, Project, Provider, Task } from '../shared/types.js';
import type { Store } from './store.js';
import { defaultPolicy } from '../shared/schemas.js';
import type { ConsoleEvent, ModelProgress } from '../shared/console.js';
import { saveResponseIssue } from './work-results.js';

export type GenerationContext = {
  requestPurpose?: ModelProgress['purpose'];
  inputContext?: Pick<ModelProgress, 'inputBytes' | 'contextLimitBytes' | 'sourceCount'>;
  onIdea?: (idea: import('../shared/ideas.js').IdeaProposal) => void;
  onMeetingActions?: (actions: { taskId: string; action: string }[]) => void;
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
    .filter(
      (t) =>
        final ||
        !!task.conversationMessageId ||
        task.dependencies.includes(t.id) ||
        t.id === task.requestedByTaskId,
    )
    .map((t) => ({
      sourceId: `task:${t.id}`,
      briefRevision: t.briefRevision || 0,
      accepted: t.status === 'done',
      sourceStatus: t.status,
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
    usage = store.usageSummary(project.id);
  if (inputBytes > p.maxInputBytes)
    throw new Error(
      `Input exceeds the configured context limit: needs ${inputBytes} bytes; Maximum input bytes is ${p.maxInputBytes}. Raise it in Workspace controls or reduce the assignment. No request was sent.`,
    );
  if (usage.requests24h >= p.maxRequests24h)
    throw new Error(
      `The request limit for the last 24 hours has been reached: ${usage.requests24h} recorded / ${p.maxRequests24h} allowed. Review Usage or change Requests in the last 24 hours in Workspace controls. No request was sent.`,
    );
  if (usage.running >= p.maxConcurrent)
    throw new Error(
      `Another worker is active: ${usage.running} running / ${p.maxConcurrent} allowed. Wait, or change Active tasks across the workspace in Workspace controls.`,
    );
  if (task && store.hasUncertain('task_id', task.id))
    throw new Error(
      'An earlier attempt is uncertain. Acknowledge it in Usage before retrying; it may already have consumed usage.',
    );
  if (meetingId && store.hasUncertain('meeting_id', meetingId))
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
    const daily = usage.cost24h,
      projectCost = usage.projectCost;
    if (daily + reservedUsd > p.dailyBudgetUsd || projectCost + reservedUsd > p.projectBudgetUsd)
      throw new Error(
        `The next request would exceed the budget estimate: next reservation $${reservedUsd.toFixed(4)}, rolling usage $${daily.toFixed(4)} / $${p.dailyBudgetUsd}, project usage $${projectCost.toFixed(4)} / $${p.projectBudgetUsd}. Review API estimate budgets and model prices in Workspace controls. No request was sent.`,
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
    progress: {
      stage: 'waiting',
      purpose: ctx.requestPurpose || 'initial',
      ...ctx.inputContext,
      inputBytes: Buffer.byteLength(system + user, 'utf8'),
      outputLimitTokens: policy(store).maxOutputTokens,
      timeoutSeconds: ctx.project?.requestTimeoutSeconds || 900,
    },
  });
  ctx.onTrace?.({
    id: 'waiting-for-output',
    type: 'status',
    text: `Contacting ${provider}${model ? ` / ${model}` : ''}; waiting for public output. No completion receipt has been received.`,
    status: 'waiting',
    progress: { stage: 'waiting', purpose: ctx.requestPurpose || 'initial' },
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
      ctx.onTrace?.({
        id: 'result',
        type: 'response',
        text: result.text,
        status: 'completed',
        progress: {
          stage: 'validating',
          purpose: ctx.requestPurpose,
          receivedCharacters: result.text.length,
        },
      });
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
          text: result.text.slice(0, RESOURCE_LIMITS.modelReplyCharacters),
          outputLimitReached:
            result.outputLimitReached || result.text.length > RESOURCE_LIMITS.modelReplyCharacters,
          observations: result.observations,
        },
      );
    }
    completionConfirmed = true;
    if (task && result.observations) task.observations = result.observations;
    if (result.outputLimitReached) {
      const message = `The model reached the configured output token limit (${policy(store).maxOutputTokens}) before finishing its response. Open Workspace controls → Maximum output tokens and raise it within your budget, or request a smaller deliverable, then retry. The partial reply is saved; no automatic retry or API fallback was attempted.`;
      saveResponseIssue(task, result.text, [message]);
      ctx.onContext?.();
      throw new Error(message);
    }
    if (!result.text.trim()) throw new Error('The model returned no document.');
    if (result.text.length > RESOURCE_LIMITS.modelReplyCharacters)
      throw new Error(
        `The model response is ${result.text.length} characters; the raw response limit is ${RESOURCE_LIMITS.modelReplyCharacters}. Lower Maximum output tokens or split the assignment. The partial reply is saved; no automatic retry was attempted.`,
      );
    if (store && attempt && ctx.cache !== false && (!ctx.cacheWhen || ctx.cacheWhen(result.text)))
      store.cache(key, result.text);
    ctx.onTrace?.({
      type: 'status',
      progress: {
        stage: 'validating',
        purpose: ctx.requestPurpose,
        receivedCharacters: result.text.length,
      },
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
