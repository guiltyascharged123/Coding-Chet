import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  Activity,
  Agent,
  Bootstrap,
  DocumentPack,
  Project,
  Provider,
  Task,
} from '../shared/types.js';
import { Store } from './store.js';
import { planProject, runTask, runtimeInfo } from './providers.js';
import { demoPlan } from './seed.js';
import { hash, memoryCurrent, policy, reserve, selectedMemory, relevantContext } from './policy.js';
import { policySchema } from '../shared/schemas.js';
import type { CostPolicy } from '../shared/types.js';

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export class Engine extends EventEmitter {
  private active = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    public store: Store,
    private stepMs = Number(process.env.DEMO_STEP_MS || 8000),
  ) {
    super();
    const configured = process.env.AGENT_PROVIDER as Provider | undefined;
    if (configured && runtimeInfo().available[configured]) {
      store.state.provider = configured;
    }
    if (!runtimeInfo().available[store.state.provider]) store.state.provider = 'demo';
    for (const project of store.state.projects)
      if (!project.model && project.provider !== 'demo' && project.provider !== 'external')
        project.model = runtimeInfo().models[project.provider];
    store.save();
  }
  get state() {
    return this.store.state;
  }
  bootstrap(): Bootstrap {
    return {
      state: {
        ...this.state,
        memory: (this.state.memory || []).map((m) => ({
          ...m,
          stale: !memoryCurrent(m, this.state.tasks),
        })),
      },
      runtime: runtimeInfo(),
      attempts: this.store
        .attempts()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 500),
    };
  }
  commit() {
    this.state.activities = this.state.activities.slice(0, 250);
    this.store.save();
    this.emit('change', this.bootstrap());
  }
  event(
    projectId: string,
    type: Activity['type'],
    message: string,
    agentId?: string,
    targetAgentId?: string,
  ) {
    this.state.activities.unshift({
      id: randomUUID(),
      projectId,
      agentId,
      targetAgentId,
      type,
      message,
      createdAt: Date.now(),
    });
  }
  start() {
    this.timer = setInterval(() => this.tick(), 300);
  }
  stop() {
    clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort();
  }
  project(id: string) {
    const project = this.state.projects.find((p) => p.id === id);
    if (!project) throw new AppError('Project not found.', 404);
    return project;
  }
  task(id: string) {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task) throw new AppError('Task not found.', 404);
    return task;
  }
  async createProject(
    title: string,
    brief: string,
    documentPack: DocumentPack = 'studio',
    planning: 'template' | 'ai' = 'template',
  ) {
    const project: Project = {
      id: randomUUID(),
      title,
      brief,
      createdAt: Date.now(),
      status: 'ready',
      provider: this.state.provider,
      documentPack,
      planning,
      model:
        this.state.provider === 'demo' || this.state.provider === 'external'
          ? undefined
          : runtimeInfo().models[this.state.provider],
    };
    const tasks =
      planning === 'ai'
        ? await planProject(project, this.state.agents, { store: this.store, project })
        : demoPlan(project, this.state.agents);
    this.state.projects.unshift(project);
    this.state.tasks.push(...tasks);
    this.event(
      project.id,
      'system',
      `The brief is mapped into ${tasks.length} tasks, with a human review before implementation.`,
      this.state.agents[0].id,
    );
    this.commit();
    return project;
  }
  setProvider(provider: Provider) {
    if (!runtimeInfo().available[provider])
      throw new AppError(
        'This runtime is not configured. Configure it on the server, restart, and check connections.',
      );
    if (this.active.size || this.state.projects.some((p) => p.status === 'running'))
      throw new AppError('Pause running projects before changing the runtime.', 409);
    this.state.provider = provider;

    this.commit();
  }

  setProjectProvider(id: string, provider: Provider) {
    const p = this.project(id);
    if (
      p.status === 'running' ||
      this.state.tasks.some((t) => t.projectId === id && t.status === 'working')
    )
      throw new AppError('Pause the project before changing its connection.');
    if (!runtimeInfo().available[provider])
      throw new AppError('The selected connection is not configured.');
    p.provider = provider;
    p.model =
      provider === 'demo' || provider === 'external' ? undefined : runtimeInfo().models[provider];
    this.event(
      id,
      'system',
      `You explicitly selected ${provider} for this project. Existing outputs and tasks were retained.`,
    );
    this.commit();
  }
  updatePolicy(value: unknown) {
    this.state.policy = policySchema.parse(value);
    this.commit();
  }
  acknowledge(id: string) {
    const a = this.store.attempts().find((a) => a.id === id);
    if (!a || a.status !== 'uncertain')
      throw new AppError('Only uncertain attempts can be acknowledged.');
    this.store.putAttempt({ ...a, status: 'acknowledged' });
    this.commit();
  }
  restore(value: unknown) {
    if (this.active.size || this.state.tasks.some((t) => t.status === 'working'))
      throw new AppError('Pause all work before restoring a backup.');
    this.store.restore(value);
    this.commit();
  }
  addMemory(projectId: string, content: string, sourceTaskId?: string) {
    this.project(projectId);
    const source = sourceTaskId ? this.task(sourceTaskId) : undefined;
    if (source && (source.projectId !== projectId || source.status !== 'done'))
      throw new AppError('Memory sources must be completed tasks in this project.');
    this.state.memory ||= [];
    this.state.memory.push({
      id: randomUUID(),
      projectId,
      content,
      status: 'proposed',
      sourceTaskId,
      sourceHash: source ? hash(source.output) : undefined,
      createdAt: Date.now(),
    });
    this.commit();
  }
  changeMemory(id: string, action: 'verify' | 'delete') {
    const m = this.state.memory?.find((m) => m.id === id);
    if (!m) throw new AppError('Memory record not found.');
    if (action === 'delete') this.state.memory = this.state.memory!.filter((m) => m.id !== id);
    else {
      if (!memoryCurrent(m, this.state.tasks))
        throw new AppError(
          'The source is stale. Add a fresh memory record from the current document.',
        );
      m.status = 'verified';
    }
    this.commit();
  }
  updateAgent(
    id: string,
    values: Pick<Agent, 'name' | 'role' | 'specialty' | 'desk'> & { goal?: string },
  ) {
    const agent = this.state.agents.find((a) => a.id === id);
    if (!agent) throw new AppError('Agent not found.', 404);
    const other = this.state.agents.find((a) => a.desk === values.desk && a.id !== id);
    if (other) other.desk = agent.desk;
    Object.assign(agent, values);
    this.commit();
  }
  runProject(id: string) {
    const project = this.project(id);
    if (project.status === 'completed')
      throw new AppError('This project is complete. Create a new project to run another brief.');
    if (this.state.tasks.filter((t) => t.projectId === id).length > policy(this.store).maxTasks)
      throw new AppError(
        'This plan exceeds the task limit. Increase the limit in Workspace controls; no tasks have been discarded.',
      );
    if (!runtimeInfo().available[project.provider])
      throw new AppError(
        'The project runtime is not configured. Configure it and check connections, or explicitly change this project’s connection in Workspace controls.',
      );
    project.status = this.state.approvals.some((a) => a.projectId === id && a.status === 'pending')
      ? 'needs_input'
      : 'running';
    this.event(
      id,
      'system',
      project.status === 'needs_input'
        ? 'Waiting for your review before continuing.'
        : 'The team is on it. Follow their handoffs in the activity feed.',
    );
    this.commit();
    this.tick();
  }
  pauseProject(id: string) {
    const project = this.project(id);
    if (project.status === 'completed') throw new AppError('This project is already complete.');
    project.status = 'paused';
    for (const task of this.state.tasks.filter(
      (t) => t.projectId === id && t.status === 'working',
    )) {
      this.active.get(task.id)?.abort();
      if (task.attemptId) {
        const a = this.store.attempts().find((a) => a.id === task.attemptId);
        if (a?.status === 'running')
          this.store.putAttempt({
            ...a,
            status: 'uncertain',
            error: 'Cancelled; provider usage may already have been consumed.',
          });
      }
      task.status = 'queued';
      delete task.startedAt;
      delete task.leaseId;
      delete task.leaseExpiresAt;
    }
    this.event(id, 'system', 'Project paused. Work can resume from the saved task queue.');
    this.commit();
  }
  retryTask(id: string) {
    const task = this.task(id);
    if (task.status !== 'failed') throw new AppError('Only failed tasks can be retried.');
    if (this.store.attempts().some((a) => a.taskId === id && a.status === 'uncertain'))
      throw new AppError('Acknowledge uncertain usage in Workspace controls before retrying.');
    task.status = 'queued';
    delete task.error;
    const project = this.project(task.projectId);
    project.status = this.state.approvals.some(
      (a) => a.projectId === project.id && a.status === 'pending',
    )
      ? 'needs_input'
      : 'running';
    this.event(task.projectId, 'system', `Queued “${task.title}” for another attempt.`);
    this.commit();
    this.tick();
  }
  review(id: string, decision: 'approve' | 'revise', feedback: string) {
    const approval = this.state.approvals.find((a) => a.id === id);
    if (!approval) throw new AppError('Review not found.', 404);
    if (approval.status !== 'pending')
      throw new AppError('This review has already been resolved.', 409);
    if (decision === 'revise' && !feedback.trim())
      throw new AppError('Tell the agent what you would like changed.');
    const task = this.task(approval.taskId);
    if (decision === 'revise' && (task.revisions || 0) >= policy(this.store).maxRevisions)
      throw new AppError(
        'The revision limit is reached. Increase it explicitly in Workspace controls before requesting another revision.',
      );
    approval.status = decision === 'approve' ? 'approved' : 'revision';
    approval.feedback = feedback;
    if (decision === 'approve') {
      task.status = 'done';
      task.completedAt = Date.now();
      this.handoff(task);
    } else {
      task.status = 'queued';
      task.feedback = feedback;
      task.revisions = (task.revisions || 0) + 1;
      delete task.startedAt;
    }
    const project = this.project(approval.projectId);
    if (project.status !== 'paused')
      project.status = this.state.approvals.some(
        (a) => a.projectId === project.id && a.status === 'pending',
      )
        ? 'needs_input'
        : 'running';
    this.event(
      project.id,
      'system',
      decision === 'approve'
        ? `You approved “${task.title}”. The team can continue.`
        : `You requested changes to “${task.title}”. Your feedback is attached to the next attempt.`,
    );
    this.checkCompletion(project);
    this.commit();
    this.tick();
  }
  private runnable(task: Task) {
    return (
      task.status === 'queued' &&
      this.project(task.projectId).status === 'running' &&
      task.dependencies.every((id) => this.task(id).status === 'done') &&
      !this.state.tasks.some((t) => t.agentId === task.agentId && t.status === 'working')
    );
  }
  tick() {
    let expired = false;
    for (const task of this.state.tasks)
      if (task.status === 'working' && task.leaseExpiresAt && task.leaseExpiresAt < Date.now()) {
        const attempt = this.store.attempts().find((a) => a.id === task.attemptId);
        if (attempt?.status === 'running')
          this.store.putAttempt({
            ...attempt,
            status: 'uncertain',
            error: 'Worker lease expired. Work or usage may already have happened.',
          });
        this.fail(
          task,
          'The worker lease expired. Review uncertain usage before retrying; work will not be repeated automatically.',
        );
        expired = true;
      }
    if (expired) this.commit();
    for (const task of this.state.tasks) {
      if (
        this.state.tasks.filter((t) => t.status === 'working').length >=
        policy(this.store).maxConcurrent
      )
        break;
      if (
        this.active.has(task.id) ||
        !this.runnable(task) ||
        this.project(task.projectId).provider === 'external'
      )
        continue;
      const controller = new AbortController();
      this.active.set(task.id, controller);
      this.begin(task);
      void this.execute(task, controller).finally(() => this.active.delete(task.id));
    }
  }
  private begin(task: Task) {
    task.status = 'working';
    task.startedAt = Date.now();
    delete task.error;
    this.event(task.projectId, 'started', `Started “${task.title}”.`, task.agentId);
    const previous = task.dependencies.map((id) => this.task(id)).at(-1);
    if (previous)
      this.event(
        task.projectId,
        'message',
        `Picked up ${this.state.agents.find((a) => a.id === previous.agentId)?.name || 'the team'}’s handoff and the shared project context.`,
        task.agentId,
        previous.agentId,
      );
    this.commit();
  }
  private async execute(task: Task, controller: AbortController) {
    const project = this.project(task.projectId);
    const agent = this.state.agents.find((a) => a.id === task.agentId)!;
    try {
      if (project.provider === 'demo') {
        await delay(this.stepMs / 2, undefined, { signal: controller.signal });
        this.event(
          project.id,
          'message',
          task.feedback
            ? 'Revisiting the draft with your feedback in mind.'
            : 'Connecting the brief with the team’s decisions. The deliverable is taking shape.',
          agent.id,
        );
        this.commit();
        await delay(this.stepMs / 2, undefined, { signal: controller.signal });
      }
      const context = this.state.tasks.filter(
        (t) => t.projectId === project.id && t.status === 'done',
      );
      const output = await runTask(
        project.provider,
        project,
        task,
        agent,
        context,
        controller.signal,
        {
          store: this.store,
          project,
          task,
          onAttempt: (id) => {
            task.attemptId = id;
            this.commit();
          },
        },
      );
      if (!controller.signal.aborted) this.complete(task, output);
    } catch (error) {
      if (!controller.signal.aborted)
        this.fail(task, error instanceof Error ? error.message : 'The task failed. Please retry.');
    }
  }
  private handoff(task: Task) {
    const next = this.state.tasks.find((t) => t.dependencies.includes(task.id));
    this.event(
      task.projectId,
      'completed',
      `Finished “${task.title}”. ${next ? 'The next teammate has the handoff.' : 'The deliverable is ready in Outputs.'}`,
      task.agentId,
      next?.agentId,
    );
  }
  private complete(task: Task, output: string) {
    if (!output.trim()) throw new AppError('A completed task must include a deliverable.');
    task.output = output;
    delete task.leaseId;
    delete task.leaseExpiresAt;
    const project = this.project(task.projectId);
    if (task.requiresApproval) {
      task.status = 'review';
      this.state.approvals.push({
        id: randomUUID(),
        projectId: project.id,
        taskId: task.id,
        question: `Is this the right direction for ${project.title}?`,
        status: 'pending',
        createdAt: Date.now(),
      });
      if (project.status !== 'paused') project.status = 'needs_input';
      this.event(
        project.id,
        'approval',
        `“${task.title}” is ready for your review. Dependent tasks will wait for your decision.`,
        task.agentId,
      );
    } else {
      task.status = 'done';
      task.completedAt = Date.now();
      this.handoff(task);
    }
    this.checkCompletion(project);
    this.commit();
  }
  private fail(task: Task, message: string) {
    task.status = 'failed';
    task.error = message;
    delete task.leaseId;
    delete task.leaseExpiresAt;
    this.project(task.projectId).status = 'paused';
    this.event(task.projectId, 'error', message, task.agentId);
    this.commit();
  }
  private checkCompletion(project: Project) {
    const tasks = this.state.tasks.filter((t) => t.projectId === project.id);
    if (tasks.length && tasks.every((t) => t.status === 'done')) {
      project.status = 'completed';
      this.event(
        project.id,
        'system',
        'That’s a wrap. All deliverables are ready to explore and download in Outputs.',
      );
    }
  }
  claim(agentId?: string) {
    if (
      this.state.tasks.filter((t) => t.status === 'working').length >=
      policy(this.store).maxConcurrent
    )
      return null;
    const task = this.state.tasks.find(
      (t) =>
        this.project(t.projectId).provider === 'external' &&
        (!agentId || t.agentId === agentId) &&
        this.runnable(t),
    );
    if (!task) return null;
    const attempt = reserve(
      this.store,
      this.project(task.projectId),
      'external',
      'task',
      'unmanaged',
      0,
      task,
    );
    task.attemptId = attempt.id;
    task.leaseId = randomUUID();
    task.leaseExpiresAt = Date.now() + 120_000;
    this.begin(task);
    return {
      task: structuredClone(task),
      agent: this.state.agents.find((a) => a.id === task.agentId),
      project: this.project(task.projectId),
      context: relevantContext(
        task,
        this.state.tasks.filter((t) => t.projectId === task.projectId && t.status === 'done'),
      ),
      memory: selectedMemory(this.store, task.projectId),
      limits: {
        maxOutputTokens: policy(this.store).maxOutputTokens,
        maxInputBytes: policy(this.store).maxInputBytes,
      },
    };
  }
  private leased(id: string, leaseId: string) {
    const task = this.task(id);
    if (
      task.status !== 'working' ||
      task.leaseId !== leaseId ||
      !task.leaseExpiresAt ||
      task.leaseExpiresAt < Date.now()
    )
      throw new AppError('This task lease is expired or no longer active.', 409);
    return task;
  }
  workerEvent(id: string, leaseId: string, message?: string) {
    const task = this.leased(id, leaseId);
    task.leaseExpiresAt = Date.now() + 120_000;
    if (message) this.event(task.projectId, 'message', message, task.agentId);
    this.commit();
  }
  workerComplete(id: string, leaseId: string, output: string) {
    const task = this.leased(id, leaseId);
    const a = this.store.attempts().find((a) => a.id === task.attemptId);
    if (a) this.store.putAttempt({ ...a, status: 'completed' });
    this.complete(task, output);
  }
  workerFail(id: string, leaseId: string, message: string) {
    const task = this.leased(id, leaseId),
      a = this.store.attempts().find((a) => a.id === task.attemptId);
    if (a)
      this.store.putAttempt({
        ...a,
        status: 'uncertain',
        error: 'The worker reported failure; external usage is not metered by Workroom.',
      });
    this.fail(task, message);
  }
}
