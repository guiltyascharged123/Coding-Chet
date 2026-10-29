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
  Workflow,
  Meeting,
  ReasoningEffort,
} from '../shared/types.js';
import { Store } from './store.js';
import { planProject, runTask, runtimeInfo, meetingTurn } from './providers.js';
import { templatePlan } from './plans.js';
import { projectTeam } from '../shared/workflows.js';
import { stateSchema } from '../shared/schemas.js';
import { projectWorkspace, workspaceFolder } from './workspaces.js';
import { hash, memoryCurrent, policy, reserve, selectedMemory, relevantContext } from './policy.js';
import { collaborationSchema, policySchema } from '../shared/schemas.js';
import type { FollowUp } from '../shared/work.js';
import { evidenceGaps, reportedAcceptanceGaps } from './verification.js';
import { modelReadiness } from '../shared/model-readiness.js';
import { workResultSchema } from '../shared/work.js';
import { jsonValue } from './work-results.js';
import { hasProjectTools } from '../shared/capabilities.js';
import type { ConsoleEvent } from '../shared/console.js';
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
  private serverId = randomUUID();
  private active = new Map<string, AbortController>();
  private planners = new Map<string, AbortController>();
  private conferences = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    public store: Store,
    private stepMs = Number(process.env.DEMO_STEP_MS || 8000),
    private worker: typeof runTask = runTask,
    private discuss: typeof meetingTurn = meetingTurn,
    private gatherMs = 6000,
  ) {
    super();
    const configured = process.env.AGENT_PROVIDER as Provider | undefined;
    if (
      configured &&
      ['demo', 'ollama', 'codex', 'compatible', 'openai', 'gemini', 'external'].includes(configured)
    ) {
      store.state.provider = configured;
    }
    // Connection failure is a blocker, never permission to simulate work or
    // silently switch accounts. Existing projects retain their own provider.
    if (store.state.provider === 'demo' && process.env.WORKROOM_DEMO !== '1')
      store.state.provider = 'ollama';
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
      serverId: this.serverId,
      revision: this.store.revision,
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
    this.store.save();
    this.emit('change', this.bootstrap());
  }
  private consoleEvent(
    project: Project,
    phase: 'plan' | 'task' | 'meeting',
    event: ConsoleEvent,
    task?: Task,
    agentId?: string,
    meetingId?: string,
    attemptId?: string,
  ) {
    const agent = (project.team || this.state.agents).find((a) => a.id === agentId);
    try {
      const update = this.store.putConsole({
        ...event,
        id: `${attemptId || randomUUID()}:${event.id || randomUUID()}`,
        projectId: project.id,
        phase,
        taskId: task?.id,
        taskTitle: task?.title,
        agentId,
        agentName: agent?.name,
        agentRole: agent?.role,
        meetingId,
        attemptId,
        provider: project.provider,
        model: project.model,
      });
      this.emit('console', update);
    } catch {
      this.emit('console_warning', {
        projectId: project.id,
        message:
          'Console history could not be saved. Work continues independently; reconnect to reload the history still available.',
      });
    }
  }
  private tracing(
    project: Project,
    phase: 'plan' | 'task' | 'meeting',
    task?: Task,
    agentId?: string,
    meetingId?: string,
  ) {
    let attemptId: string | undefined;
    const connection = {
      ...project,
      team: (project.team || this.state.agents).map((a) => ({ ...a })),
    };
    return {
      onAttempt: (id: string) => {
        attemptId = id;
        if (task) task.attemptId = id;
        this.commit();
      },
      onTrace: (event: ConsoleEvent) =>
        this.consoleEvent(connection, phase, event, task, agentId, meetingId, attemptId),
    };
  }
  event(
    projectId: string,
    type: Activity['type'],
    message: string,
    agentId?: string,
    targetAgentId?: string,
  ) {
    const activity: Activity = {
      id: randomUUID(),
      projectId,
      agentId,
      targetAgentId,
      type,
      message,
      createdAt: Date.now(),
    };
    this.store.recordActivity(activity);
    this.state.activities = [activity, ...this.state.activities].slice(0, 250);
  }
  start() {
    this.timer = setInterval(() => this.tick(), 300);
  }
  stop() {
    clearInterval(this.timer);
    for (const [id] of this.conferences) this.stopMeeting(id);
    for (const id of [...this.planners.keys()]) this.pauseProject(id);
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
    planning: 'template' | 'ai' | 'manual' = 'template',
    requestId?: string,
    workflow?: Workflow,
    collaboration?: {
      researchEnabled?: boolean;
      reasoningEffort: ReasoningEffort;
      meetingPolicy: { enabled: boolean; everyTasks: number };
    },
  ) {
    const existing = requestId && this.state.projects.find((p) => p.id === requestId);
    if (existing) {
      if (
        existing.title !== title ||
        existing.brief !== brief ||
        existing.workflow !== workflow ||
        existing.documentPack !== documentPack ||
        existing.planning !== planning
      )
        throw new AppError(
          'This submission ID already belongs to a different brief. Your draft has been retained.',
          409,
        );
      return existing;
    }
    const project: Project = {
      id: requestId || randomUUID(),
      title,
      brief,
      createdAt: Date.now(),
      status: 'ready',
      provider: this.state.provider,
      documentPack,
      planning,
      workflow,
      reasoningEffort: collaboration?.reasoningEffort || 'medium',
      meetingPolicy: collaboration?.meetingPolicy,
      researchEnabled: !!collaboration?.researchEnabled,
      team: workflow ? projectTeam(workflow, this.state.agents) : undefined,
      model:
        this.state.provider === 'demo' || this.state.provider === 'external'
          ? undefined
          : runtimeInfo().models[this.state.provider],
    };
    if (workflow === 'software') {
      project.workspaceFolder = workspaceFolder(project);
      projectWorkspace(this.store.path, project);
    }
    // Durability comes before any model request. A failed plan is a saved project.
    this.state.projects.unshift(project);
    this.event(project.id, 'system', 'Project and original brief saved.');
    this.commit();
    if (planning === 'ai') this.startPlanning(project);
    else
      this.finishPlan(
        project,
        planning === 'manual' ? [] : templatePlan(project, project.team || this.state.agents),
      );
    return project;
  }
  private finishPlan(project: Project, tasks: Task[]) {
    this.state.tasks.push(...tasks);
    project.planningStatus = 'ready';
    delete project.planningError;
    project.status = 'ready';
    this.event(
      project.id,
      'system',
      tasks.length
        ? `Saved a plan with ${tasks.length} tasks. Review the assignments before running.`
        : 'Manual plan created. Add tasks and acceptance criteria in Edit plan.',
    );
    this.commit();
  }
  private startPlanning(project: Project) {
    if (this.planners.has(project.id)) throw new AppError('Planning is already active.', 409);
    if (this.state.tasks.some((t) => t.projectId === project.id))
      throw new AppError('Edit the existing plan instead of replacing it.');
    if (!modelReadiness(runtimeInfo(), project.provider, project.model).ready) {
      project.planningStatus = 'failed';
      project.planningError =
        'The selected model connection is not ready. Open Model connections, complete setup and check connections, then retry planning. No model request was sent.';
      project.status = 'paused';
      this.event(project.id, 'error', project.planningError);
      this.commit();
      return;
    }
    const controller = new AbortController();
    this.planners.set(project.id, controller);
    project.planningStatus = 'planning';
    project.status = 'paused';
    delete project.planningError;
    this.commit();
    void planProject(project, project.team || this.state.agents, {
      store: this.store,
      project,
      signal: controller.signal,
      ...this.tracing(project, 'plan'),
    })
      .then((tasks) => {
        if (!controller.signal.aborted) {
          this.finishPlan(project, tasks);
          this.consoleEvent(project, 'plan', {
            type: 'status',
            text: `Saved and validated a plan with ${tasks.length} tasks.`,
            status: 'completed',
          });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          project.planningStatus = 'failed';
          project.planningError =
            error instanceof Error ? error.message : 'Planning failed. Your brief is saved.';
          project.status = 'paused';
          this.event(project.id, 'error', project.planningError);
          this.consoleEvent(project, 'plan', {
            type: 'error',
            text: project.planningError,
            status: 'failed',
          });
          this.commit();
        }
      })
      .finally(() => this.planners.delete(project.id));
  }
  retryPlanning(id: string) {
    const project = this.project(id);
    if (
      this.store
        .attempts()
        .some((a) => a.projectId === id && a.phase === 'plan' && a.status === 'uncertain')
    )
      throw new AppError(
        'Review and acknowledge uncertain planning usage in Workspace controls before retrying.',
      );
    this.startPlanning(project);
  }
  starterPlan(id: string) {
    const project = this.project(id);
    if (this.planners.has(id) || this.state.tasks.some((t) => t.projectId === id))
      throw new AppError('Stop planning first, or edit the existing plan.');
    project.planning = 'manual';
    this.finishPlan(project, []);
  }
  editPlan(id: string, rows: Task[], toolNetwork?: boolean, collaboration?: unknown) {
    const project = this.project(id);
    if (
      this.projectMeetingActive(id) ||
      this.planners.has(id) ||
      project.status === 'running' ||
      this.state.tasks.some((t) => this.active.has(t.id) && t.projectId === id) ||
      this.state.tasks.some((t) => t.projectId === id && t.status === 'working')
    )
      throw new AppError('Pause the team before editing its plan.');
    if (!rows.length || rows.length > policy(this.store).maxTasks)
      throw new AppError(
        'Keep at least one task and stay within the task limit in Workspace controls.',
      );
    const old = this.state.tasks.filter((t) => t.projectId === id);
    const merged = rows.map((row) => {
      const original = old.find((t) => t.id === row.id);
      if (original && original.status !== 'queued' && original.status !== 'failed') {
        if (
          original.title !== row.title ||
          original.description !== row.description ||
          original.agentId !== row.agentId ||
          original.requiresApproval !== row.requiresApproval ||
          !!original.readOnly !== !!row.readOnly ||
          original.workType !== row.workType ||
          JSON.stringify(original.acceptanceCriteria) !== JSON.stringify(row.acceptanceCriteria) ||
          JSON.stringify(original.dependencies) !== JSON.stringify(row.dependencies)
        )
          throw new AppError(
            'Completed, working and review tasks retain their assignments. Add a follow-up task instead.',
          );
        return original;
      }
      if (
        original &&
        this.store.attempts().some((a) => a.taskId === original.id && a.status === 'running')
      )
        throw new AppError('Wait for the cancelled worker to stop before editing.');
      const assignmentChanged =
        original &&
        (original.title !== row.title ||
          original.description !== row.description ||
          original.agentId !== row.agentId ||
          !!original.readOnly !== !!row.readOnly ||
          original.workType !== row.workType ||
          JSON.stringify(original.dependencies) !== JSON.stringify(row.dependencies) ||
          JSON.stringify(original.acceptanceCriteria) !== JSON.stringify(row.acceptanceCriteria));
      return {
        ...original,
        recovery: assignmentChanged ? undefined : original?.recovery,
        id: row.id,
        projectId: id,
        title: row.title,
        description: row.description,
        agentId: row.agentId,
        dependencies: row.dependencies,
        requiresApproval: row.requiresApproval,
        readOnly: row.readOnly,
        workType: row.workType,
        acceptanceCriteria: row.acceptanceCriteria,
        status: original?.status || 'queued',
        output: original?.output || '',
        feedback: original?.feedback || '',
      } as Task;
    });
    if (old.some((t) => t.status !== 'queued' && !merged.some((m) => m.id === t.id)))
      throw new AppError(
        'Retain tasks that have already started; their outputs and failures are part of the project record.',
      );
    const next = stateSchema.parse({
      ...this.state,
      tasks: [...this.state.tasks.filter((t) => t.projectId !== id), ...merged],
    });
    const settings =
      collaboration === undefined ? undefined : collaborationSchema.parse(collaboration);
    // Preserve task objects held by workers in other projects. Validation clones them.
    this.state.tasks = [
      ...this.state.tasks.filter((t) => t.projectId !== id),
      ...next.tasks.filter((t) => t.projectId === id),
    ];
    if (settings) Object.assign(project, settings);
    if (hasProjectTools(project) && toolNetwork !== undefined) project.toolNetwork = toolNetwork;
    project.planningStatus = 'ready';
    delete project.planningError;
    project.status = 'paused';
    this.event(
      id,
      'system',
      `Plan saved with ${merged.length} tasks. Existing results were retained.`,
    );
    this.commit();
  }
  setProvider(provider: Provider) {
    if (!runtimeInfo().available[provider])
      throw new AppError(
        'This runtime is not configured. Configure it on the server, restart, and check connections.',
      );
    if (
      this.conferences.size ||
      this.planners.size ||
      this.active.size ||
      this.state.projects.some((p) => p.status === 'running')
    )
      throw new AppError('Pause running projects before changing the runtime.', 409);
    this.state.provider = provider;

    this.commit();
  }

  setProjectProvider(
    id: string,
    provider: Provider,
    model?: string,
    workMode?: 'text' | 'workspace',
  ) {
    const p = this.project(id);
    if (
      this.projectMeetingActive(id) ||
      this.planners.has(id) ||
      p.status === 'running' ||
      this.state.tasks.some(
        (t) => t.projectId === id && (t.status === 'working' || this.active.has(t.id)),
      )
    )
      throw new AppError('Pause the project before changing its connection.');
    const selected =
      model?.trim() ||
      (provider !== 'demo' && provider !== 'external' ? runtimeInfo().models[provider] : '');
    if (
      provider !== 'demo' &&
      provider !== 'external' &&
      !/^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,149}$/.test(selected)
    )
      throw new AppError(
        'Enter an exact model ID (up to 150 characters, without spaces). Model access is checked by your provider when work runs.',
      );
    const readiness = modelReadiness(runtimeInfo(), provider, selected);
    if (!readiness.ready) throw new AppError(readiness.message);
    const tools = p.workflow === 'software' || (workMode || p.workMode) === 'workspace';
    if (tools && provider !== 'codex')
      throw new AppError(
        'Managed project tools require Codex. Disable that option before choosing a text connection. Software delivery always requires Codex.',
      );
    const folder = tools ? p.workspaceFolder || workspaceFolder(p) : p.workspaceFolder;
    if (tools) projectWorkspace(this.store.path, { ...p, workspaceFolder: folder });
    const nextMode = p.workflow === 'software' ? 'workspace' : workMode || p.workMode;
    if (p.provider !== provider || p.model !== selected || p.workMode !== nextMode)
      for (const task of this.state.tasks.filter((t) => t.projectId === id)) delete task.recovery;
    p.workMode = nextMode;
    p.workspaceFolder = folder;
    p.provider = provider;
    p.model = provider === 'demo' || provider === 'external' ? undefined : selected;
    this.event(
      id,
      'system',
      `Project model set to ${provider}${p.model ? ` / ${p.model}` : ''}. Existing work and usage history retained.`,
    );
    this.commit();
  }
  updateInstructions(id: string, text: string, reason: string) {
    const project = this.project(id);
    if (
      project.status === 'running' ||
      this.planners.has(id) ||
      this.projectMeetingActive(id) ||
      this.state.tasks.some(
        (t) => t.projectId === id && (t.status === 'working' || this.active.has(t.id)),
      )
    )
      throw new AppError('Pause the project before changing team instructions.');
    if ((project.instructionHistory?.length || 0) >= 50)
      throw new AppError(
        'This project has reached its 50 saved instruction versions. Export a backup before starting a new project.',
      );
    for (const task of this.state.tasks.filter((t) => t.projectId === id)) delete task.recovery;
    project.instructionHistory ||= [];
    project.instructionHistory.push({ id: randomUUID(), text, reason, createdAt: Date.now() });
    this.event(
      id,
      'system',
      `Team instructions version ${project.instructionHistory.length} saved: ${reason}`,
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
    if (
      this.conferences.size ||
      this.planners.size ||
      this.active.size ||
      this.state.tasks.some((t) => t.status === 'working')
    )
      throw new AppError('Pause all work before restoring a backup.');
    this.store.restore(value);
    if (this.state.provider === 'demo' && process.env.WORKROOM_DEMO !== '1')
      this.state.provider = 'ollama';
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
    projectId?: string,
  ) {
    const team = projectId
      ? (this.project(projectId).team ||= structuredClone(this.state.agents))
      : this.state.agents;
    if (
      projectId &&
      (this.project(projectId).status === 'running' ||
        this.planners.has(projectId) ||
        this.conferences.size)
    )
      throw new AppError('Pause the project before editing its team.');
    const agent = team.find((a) => a.id === id);
    if (!agent) throw new AppError('Agent not found.', 404);
    const other = team.find((a) => a.desk === values.desk && a.id !== id);
    if (other) other.desk = agent.desk;
    Object.assign(agent, values);
    this.commit();
  }
  runProject(id: string) {
    const project = this.project(id);
    if (project.provider === 'demo' && process.env.WORKROOM_DEMO !== '1')
      throw new AppError(
        'This is a saved simulation project. Select a real project model before running. Its previous outputs have been retained.',
      );
    if ((this.state.meetings || []).some((m) => m.projectId === id && m.status === 'failed'))
      throw new AppError(
        'Retry or skip the failed meeting before continuing. Saved contributions are retained.',
      );
    if (
      !this.state.tasks.some((t) => t.projectId === id) ||
      project.planningStatus === 'planning' ||
      project.planningStatus === 'failed'
    )
      throw new AppError('Finish or retry planning before running the team. Your brief is saved.');
    if (hasProjectTools(project) && project.provider !== 'codex')
      throw new AppError(
        'Software delivery requires the Codex connection for real file and command tools. Select it in Workspace controls.',
      );
    if (hasProjectTools(project) && !runtimeInfo().coding?.ready)
      throw new AppError(
        runtimeInfo().coding?.message || 'Check coding sandbox readiness in Model connections.',
      );
    if (project.status === 'completed')
      throw new AppError('This project is complete. Create a new project to run another brief.');
    if (this.state.tasks.filter((t) => t.projectId === id).length > policy(this.store).maxTasks)
      throw new AppError(
        'This plan exceeds the task limit. Increase the limit in Workspace controls; no tasks have been discarded.',
      );
    if (!modelReadiness(runtimeInfo(), project.provider, project.model).ready)
      throw new AppError(modelReadiness(runtimeInfo(), project.provider, project.model).message);
    project.status = this.state.approvals.some((a) => a.projectId === id && a.status === 'pending')
      ? 'needs_input'
      : 'running';
    this.event(
      id,
      'system',
      project.status === 'needs_input'
        ? 'Waiting for your review before continuing.'
        : 'Project started. Eligible tasks will use the selected model connection.',
    );
    this.commit();
    this.tick();
  }
  pauseProject(id: string) {
    const project = this.project(id);
    for (const meeting of this.state.meetings || [])
      if (meeting.projectId === id && this.conferences.has(meeting.id))
        this.stopMeeting(meeting.id);
    if (project.status === 'completed') throw new AppError('This project is already complete.');
    project.status = 'paused';
    const planner = this.planners.get(id);
    if (planner) {
      planner.abort();
      project.planningStatus = 'failed';
      project.planningError =
        'Planning stopped. Your brief is saved; review Usage before retrying.';
      for (const a of this.store.attempts())
        if (a.projectId === id && a.phase === 'plan' && a.status === 'running')
          this.store.putAttempt({ ...a, status: 'uncertain' });
    }
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
      task.status = task.attemptId ? 'failed' : 'queued';
      if (task.attemptId)
        task.error =
          'Cancelled work needs review. Wait for the worker to stop, then inspect Usage and existing files before retrying.';
      delete task.startedAt;
      delete task.leaseId;
      delete task.leaseExpiresAt;
    }
    this.event(id, 'system', 'Project paused. Work can resume from the saved task queue.');
    this.commit();
  }
  recoverTask(id: string) {
    const task = this.task(id);
    if (this.active.has(id))
      throw new AppError('Wait for the cancelled worker to stop before recovering.');
    if (task.status !== 'failed' || !task.recovery)
      throw new AppError('This task has no interrupted result to recover.');
    const response = this.store.attemptResult(task.recovery.attemptId);
    if (!response || response.outputLimitReached)
      throw new AppError(
        'A complete reply is unavailable. Inspect Usage and existing files before retrying.',
      );
    const parsed = workResultSchema.safeParse(jsonValue(response.text));
    if (!parsed.success)
      throw new AppError(
        'The saved reply is not an accepted work result. Inspect the saved response in Live console before retrying.',
      );
    if (parsed.data.outcome === 'complete' && reportedAcceptanceGaps(task, parsed.data).length)
      throw new AppError(
        'Saved reply does not check all assigned acceptance criteria. Inspect it before retrying.',
      );
    if (hasProjectTools(this.project(task.projectId)) && parsed.data.outcome === 'complete') {
      const gaps = evidenceGaps(task, response.observations || [], parsed.data);
      if (gaps.length)
        throw new AppError('Saved result lacks observed evidence: ' + gaps.join(' '));
    }
    task.observations = response.observations;
    task.result = parsed.data;
    task.output = parsed.data.deliverable;
    delete task.recovery;
    delete task.error;
    if (task.result.outcome === 'continue') this.coordinate(task, task.result.followUps);
    else if (task.result.outcome === 'blocked') this.fail(task, task.result.summary);
    else this.complete(task, task.output);
    this.event(
      task.projectId,
      'system',
      'Recovered the saved model result without sending another model request.',
      task.agentId,
    );
    this.commit();
  }
  retryTask(id: string, feedback?: string) {
    const task = this.task(id);
    if (task.status !== 'failed') throw new AppError('Only failed tasks can be retried.');
    if (this.active.has(id))
      throw new AppError('Wait for the cancelled worker to stop before retrying.');
    if (this.store.attempts().some((a) => a.taskId === id && a.status === 'uncertain'))
      throw new AppError('Acknowledge uncertain usage in Workspace controls before retrying.');
    const target = this.project(task.projectId);
    if ((this.state.meetings || []).some((m) => m.projectId === target.id && m.status === 'failed'))
      throw new AppError('Retry or skip the failed meeting before retrying work.');
    if (
      hasProjectTools(target) &&
      (target.provider !== 'codex' ||
        !runtimeInfo().available.codex ||
        !runtimeInfo().coding?.ready)
    )
      throw new AppError(
        'Software delivery requires a ready Codex connection and coding sandbox. Check Model connections.',
      );
    if (!modelReadiness(runtimeInfo(), target.provider, target.model).ready)
      throw new AppError(modelReadiness(runtimeInfo(), target.provider, target.model).message);
    delete task.recovery;
    task.status = 'queued';
    if (feedback?.trim()) task.feedback = feedback.trim();
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
  review(id: string, decision: 'approve' | 'revise', feedback: string, choice?: string) {
    const approval = this.state.approvals.find((a) => a.id === id);
    if (!approval) throw new AppError('Review not found.', 404);
    if (approval.status !== 'pending')
      throw new AppError('This review has already been resolved.', 409);
    if (decision === 'revise' && !feedback.trim())
      throw new AppError('Tell the agent what you would like changed.');
    if (
      decision === 'approve' &&
      approval.decision &&
      choice &&
      !approval.decision.options.includes(choice)
    )
      throw new AppError('Choose one of the listed options; put a custom direction in feedback.');
    const task = this.task(approval.taskId);
    if (decision === 'revise' && (task.revisions || 0) >= policy(this.store).maxRevisions)
      throw new AppError(
        'The revision limit is reached. Increase it explicitly in Workspace controls before requesting another revision.',
      );
    approval.status = decision === 'approve' ? 'approved' : 'revision';
    approval.feedback =
      approval.decision && decision === 'approve'
        ? `${approval.decision.question}\nUser choice: ${choice || approval.decision.recommended}${feedback.trim() ? `\nAdditional direction: ${feedback.trim()}` : ''}`
        : feedback;
    if (decision === 'approve') {
      task.status = approval.resumeTask ? 'queued' : 'done';
      if (!approval.resumeTask) {
        task.completedAt = Date.now();
        this.handoff(task);
      }
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
  configureCollaboration(id: string, value: unknown) {
    const project = this.project(id);
    if (
      project.status === 'running' ||
      this.state.tasks.some((t) => t.projectId === id && this.active.has(t.id)) ||
      this.planners.has(id) ||
      this.projectMeetingActive(id)
    )
      throw new AppError('Pause this project before changing collaboration settings.');
    Object.assign(project, collaborationSchema.parse(value));
    this.commit();
  }
  private projectMeetingActive(id: string) {
    return (this.state.meetings || []).some(
      (m) => m.projectId === id && this.conferences.has(m.id),
    );
  }
  meeting(id: string) {
    const meeting = this.state.meetings?.find((m) => m.id === id);
    if (!meeting) throw new AppError('Meeting not found.', 404);
    return meeting;
  }
  startMeeting(projectId: string, agenda: string, trigger: Meeting['trigger'] = 'manual') {
    const project = this.project(projectId);
    if (
      this.active.size ||
      this.planners.size ||
      this.conferences.size ||
      this.state.tasks.some((t) => t.status === 'working')
    )
      throw new AppError(
        `Wait for active work to finish, or pause it, before starting a team meeting. Active projects: ${this.state.projects
          .filter(
            (p) =>
              this.planners.has(p.id) ||
              this.projectMeetingActive(p.id) ||
              this.state.tasks.some(
                (t) => t.projectId === p.id && (t.status === 'working' || this.active.has(t.id)),
              ),
          )
          .map((p) => p.title)
          .join(', ')}.`,
      );
    if (
      !modelReadiness(runtimeInfo(), project.provider, project.model).ready ||
      project.provider === 'external'
    )
      throw new AppError(
        'Team meetings require a configured direct model connection. External workers retain their task protocol.',
      );
    if ((this.state.meetings || []).some((m) => m.projectId === projectId && m.status === 'failed'))
      throw new AppError('Retry or skip the saved failed meeting first.');
    const meeting: Meeting = {
      id: randomUUID(),
      projectId,
      agenda,
      trigger,
      status: 'gathering',
      checkpoint: this.state.tasks.filter((t) => t.projectId === projectId && t.status === 'done')
        .length,
      participants: structuredClone(project.team || this.state.agents),
      contributions: [],
      summary: '',
      createdAt: Date.now(),
    };
    (this.state.meetings ||= []).push(meeting);
    this.launchMeeting(meeting);
    return meeting;
  }
  retryMeeting(id: string) {
    const meeting = this.meeting(id);
    if (meeting.status !== 'failed') throw new AppError('Only failed meetings can be retried.');
    if (
      this.active.size ||
      this.planners.size ||
      this.conferences.size ||
      this.state.tasks.some((t) => t.status === 'working')
    )
      throw new AppError('Pause active work before retrying a meeting.');
    if (this.store.attempts().some((a) => a.meetingId === id && a.status === 'uncertain'))
      throw new AppError(
        'Acknowledge uncertain meeting usage in Workspace controls before retrying. Completed contributions will not be repeated.',
      );
    this.launchMeeting(meeting);
  }
  skipMeeting(id: string) {
    const meeting = this.meeting(id);
    if (this.conferences.has(id)) throw new AppError('Stop the meeting before skipping it.');
    if (meeting.status !== 'failed')
      throw new AppError('Only a stopped or failed meeting can be skipped.');
    meeting.status = 'cancelled';
    delete meeting.speakerId;
    this.event(
      meeting.projectId,
      'system',
      'You skipped the meeting. Saved contributions and usage receipts were retained.',
    );
    this.commit();
  }
  stopMeeting(id: string) {
    const meeting = this.meeting(id),
      controller = this.conferences.get(id);
    if (!controller) return;
    controller.abort();
    meeting.status = 'failed';
    delete meeting.speakerId;
    meeting.error =
      'Meeting stopped. Contributions are saved; review uncertain Usage before retrying.';
    const project = this.project(meeting.projectId);
    if (project.status === 'running') project.status = 'paused';
    for (const a of this.store.attempts())
      if (a.meetingId === id && a.status === 'running')
        this.store.putAttempt({ ...a, status: 'uncertain' });
    this.commit();
  }
  private launchMeeting(meeting: Meeting) {
    const project = this.project(meeting.projectId),
      controller = new AbortController();
    this.conferences.set(meeting.id, controller);
    meeting.status = 'gathering';
    delete meeting.error;
    this.event(
      project.id,
      'system',
      `Team gathering for ${meeting.trigger === 'kickoff' ? 'kickoff' : 'a project meeting'}: ${meeting.agenda}`,
    );
    this.commit();
    void (async () => {
      try {
        await delay(this.gatherMs, undefined, { signal: controller.signal });
        meeting.status = 'running';
        this.commit();
        for (const agent of meeting.participants) {
          if (meeting.contributions.some((c) => c.agentId === agent.id)) continue;
          meeting.speakerId = agent.id;
          this.commit();
          if (project.provider === 'demo')
            await delay(Math.min(1500, this.stepMs / 2), undefined, { signal: controller.signal });
          const content = await this.discuss(project, meeting, agent, false, {
            store: this.store,
            project,
            signal: controller.signal,
            ...this.tracing(project, 'meeting', undefined, agent.id, meeting.id),
          });
          if (controller.signal.aborted) return;
          meeting.contributions.push({
            agentId: agent.id,
            role: agent.role,
            content: content.slice(0, 20000),
            createdAt: Date.now(),
          });
          this.event(
            project.id,
            'message',
            `${agent.name} shared a ${agent.role} contribution in the team discussion.`,
            agent.id,
          );
          this.commit();
        }
        meeting.speakerId = meeting.participants[0].id;
        this.commit();
        const summary = await this.discuss(project, meeting, meeting.participants[0], true, {
          store: this.store,
          project,
          signal: controller.signal,
          ...this.tracing(project, 'meeting', undefined, meeting.participants[0].id, meeting.id),
        });
        if (controller.signal.aborted) return;
        meeting.summary = summary.slice(0, 20000);
        meeting.status = 'completed';
        meeting.completedAt = Date.now();
        delete meeting.speakerId;
        this.event(
          project.id,
          'system',
          'Team meeting finished. Its decision record and open objections will guide subsequent assignments.',
        );
        this.commit();
      } catch (error) {
        if (!controller.signal.aborted) {
          meeting.status = 'failed';
          meeting.error =
            error instanceof Error ? error.message : 'Meeting failed; contributions are saved.';
          delete meeting.speakerId;
          if (project.status === 'running') project.status = 'paused';
          this.event(project.id, 'error', meeting.error);
          this.commit();
        }
      } finally {
        this.conferences.delete(meeting.id);
      }
    })();
  }
  private scheduleMeetings() {
    if (
      this.active.size ||
      this.planners.size ||
      this.conferences.size ||
      this.state.tasks.some((t) => t.status === 'working')
    )
      return;
    for (const project of this.state.projects) {
      if (
        project.status !== 'running' ||
        !project.meetingPolicy?.enabled ||
        project.provider === 'external' ||
        !modelReadiness(runtimeInfo(), project.provider, project.model).ready
      )
        continue;
      const meetings = (this.state.meetings || []).filter((m) => m.projectId === project.id);
      if (
        meetings.some(
          (m) => m.status === 'failed' || m.status === 'running' || m.status === 'gathering',
        )
      )
        continue;
      const tasks = this.state.tasks.filter((t) => t.projectId === project.id),
        done = tasks.filter((t) => t.status === 'done').length;
      if (
        !tasks.some(
          (t) =>
            t.status === 'queued' && t.dependencies.every((id) => this.task(id).status === 'done'),
        )
      )
        continue;
      const last = meetings.at(-1);
      if (last && done - last.checkpoint < project.meetingPolicy.everyTasks) continue;
      this.startMeeting(
        project.id,
        last
          ? 'Review actual progress, challenge the approach, resolve blockers and agree the next useful actions.'
          : 'Compare approaches to the goal, challenge assumptions and weak ideas, and agree a concrete direction with open questions for the user.',
        last ? 'checkpoint' : 'kickoff',
      );
      break;
    }
  }
  private runnable(task: Task) {
    return (
      !this.conferences.size &&
      !(this.state.meetings || []).some(
        (m) => m.projectId === task.projectId && m.status === 'failed',
      ) &&
      task.status === 'queued' &&
      !(
        hasProjectTools(this.project(task.projectId)) &&
        this.state.tasks.some((t) => t.projectId === task.projectId && t.status === 'working')
      ) &&
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
    this.scheduleMeetings();
    for (const task of this.state.tasks) {
      if (
        this.conferences.size +
          this.planners.size +
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
    if (this.project(task.projectId).provider !== 'external') delete task.attemptId;
    delete task.recovery;
    delete task.error;
    const project = this.project(task.projectId);
    this.consoleEvent(
      project,
      'task',
      {
        type: 'status',
        text:
          project.provider === 'demo'
            ? 'Demo task started. No AI model or tools will run.'
            : project.provider === 'external'
              ? 'External worker claimed this assignment. Internal worker messages are not available through this protocol.'
              : 'Task started. Preparing the assignment and selected project context.',
        status: 'started',
      },
      task,
      task.agentId,
    );
    this.event(task.projectId, 'started', `Started “${task.title}”.`, task.agentId);
    const previous = task.dependencies.map((id) => this.task(id)).at(-1);
    if (previous)
      this.event(
        task.projectId,
        'message',
        `Dependency completed: “${previous.title}”. Its saved result is available to this assignment.`,
        task.agentId,
        previous.agentId,
      );
    this.commit();
  }
  private async execute(task: Task, controller: AbortController) {
    const project = this.project(task.projectId);
    const agent = (project.team || this.state.agents).find((a) => a.id === task.agentId)!;
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
      const output = await this.worker(
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
          toolNetwork: !!project.toolNetwork,
          readOnly: !!task.readOnly,
          workspace: hasProjectTools(project)
            ? projectWorkspace(this.store.path, project)
            : undefined,
          cache: hasProjectTools(project) ? false : undefined,
          onTool: (raw) => {
            const entry = { ...raw, id: `${task.attemptId || task.id}:${raw.id}` };
            task.toolLog ||= [];
            const existing = task.toolLog.findIndex((e) => e.id === entry.id);
            if (existing >= 0 && JSON.stringify(task.toolLog[existing]) === JSON.stringify(entry))
              return;
            if (existing >= 0) task.toolLog[existing] = entry;
            else task.toolLog.push(entry);
            task.toolLog = task.toolLog.slice(-100);
            this.commit();
          },
          ...this.tracing(project, 'task', task, agent.id),
          onContext: () => this.commit(),
        },
      );
      if (!controller.signal.aborted) {
        if (hasProjectTools(project) && !task.result) {
          // Keep compatibility for injected/older worker adapters; production Codex uses the work contract.
          const result = JSON.parse(output) as { outcome: 'complete' | 'blocked'; summary: string };
          task.output = result.summary;
          if (result.outcome === 'blocked')
            this.fail(
              task,
              'The worker reported a blocker. Open the task for its report and tool activity; add direction and retry when ready.',
            );
          else this.complete(task, result.summary);
        } else if (task.result?.outcome === 'continue') {
          task.output = output;
          this.coordinate(task, task.result.followUps);
        } else if (task.result?.outcome === 'blocked') {
          task.output = output;
          this.fail(task, task.result.summary);
        } else this.complete(task, output);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        this.fail(task, error instanceof Error ? error.message : 'The task failed. Please retry.');
    } finally {
      if (controller.signal.aborted && task.attemptId) {
        const response = this.store.attemptResult(task.attemptId);
        task.status = 'failed';
        task.recovery = {
          attemptId: task.attemptId,
          hasResponse: !!response && !response.outputLimitReached,
        };
        task.error = response
          ? 'A reply arrived after cancellation. Recover the saved result without another request, or inspect it before retrying.'
          : 'Cancelled work needs review. Check Usage and existing files before explicitly retrying.';
        this.commit();
      }
    }
  }
  private handoff(task: Task) {
    const next = this.state.tasks.find((t) => t.dependencies.includes(task.id));
    this.event(
      task.projectId,
      'completed',
      task.result
        ? `${task.title}: ${task.result.summary}`
        : `Finished “${task.title}”. ${next ? 'The next teammate has the handoff.' : 'The deliverable is ready in Outputs.'}`,
      task.agentId,
      next?.agentId,
    );
  }
  private coordinate(task: Task, followUps: FollowUp[]) {
    const limits = policy(this.store);
    if ((task.coordinationRounds || 0) >= limits.maxRevisions)
      throw new AppError(
        'The internal follow-up limit was reached. The partial work is saved; inspect the outstanding checks before extending the plan or revision limit.',
      );
    if (
      this.state.tasks.filter((t) => t.projectId === task.projectId).length + followUps.length >
      limits.maxTasks
    )
      throw new AppError(
        'Necessary teammate follow-ups exceed the project task limit. The proposed work is saved in this task; extend the plan or task limit before retrying.',
      );
    let dependencies = [...task.dependencies];
    const created: Task[] = followUps.map((f) => {
      const next: Task = {
        ...f,
        id: randomUUID(),
        projectId: task.projectId,
        dependencies,
        status: 'queued',
        requiresApproval: false,
        output: '',
        feedback: '',
      };
      dependencies = [next.id];
      return next;
    });
    task.dependencies = [...new Set([...task.dependencies, ...dependencies])];
    task.coordinationRounds = (task.coordinationRounds || 0) + 1;
    task.status = 'queued';
    this.consoleEvent(
      this.project(task.projectId),
      'task',
      {
        type: 'status',
        text: `Queued ${created.length} internal specialist assignments. This task will resume with their results.`,
        status: 'waiting_for_team',
      },
      task,
      task.agentId,
    );
    const index = this.state.tasks.indexOf(task);
    this.state.tasks.splice(index, 0, ...created);
    this.event(
      task.projectId,
      'message',
      `Requested ${created.length} internal follow-up${created.length === 1 ? '' : 's'} before completing “${task.title}”: ${created.map((t) => t.title).join('; ')}.`,
      task.agentId,
      created[0]?.agentId,
    );
    this.commit();
  }
  private complete(task: Task, output: string) {
    if (!output.trim()) throw new AppError('A completed task must include a deliverable.');
    task.output = output;
    delete task.leaseId;
    delete task.leaseExpiresAt;
    const project = this.project(task.projectId);
    const decision = task.result?.outcome === 'needs_input' ? task.result.decision : undefined;
    if (
      decision &&
      this.state.approvals.some(
        (a) => a.taskId === task.id && a.status === 'approved' && a.question === decision.question,
      )
    )
      throw new AppError(
        'The agent repeated a decision you already answered. Your answer and partial work are saved. Review the task or choose a stronger project model before retrying.',
      );
    if (task.requiresApproval || decision) {
      task.status = 'review';
      this.state.approvals.push({
        id: randomUUID(),
        projectId: project.id,
        taskId: task.id,
        question: decision?.question || `Review the requested approval: ${task.title}`,
        decision: decision || undefined,
        resumeTask: !!decision,
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
    if (project.provider === 'demo' || project.provider === 'external')
      this.consoleEvent(
        project,
        'task',
        {
          type: 'response',
          text: output,
          status: project.provider === 'demo' ? 'demo_preview' : 'external_result',
        },
        task,
        task.agentId,
      );
    this.consoleEvent(
      project,
      'task',
      {
        type: 'status',
        text:
          task.status === 'review'
            ? 'Work is waiting for the requested human decision. Open Review work for the question and choices.'
            : 'Task work accepted. The saved result and reported checks are available in Outputs.',
        status: task.status,
      },
      task,
      task.agentId,
    );
    this.commit();
  }
  private fail(task: Task, message: string) {
    task.status = 'failed';
    task.error = message;
    delete task.leaseId;
    delete task.leaseExpiresAt;
    this.project(task.projectId).status = 'paused';
    this.consoleEvent(
      this.project(task.projectId),
      'task',
      { type: 'error', text: message, status: 'failed' },
      task,
      task.agentId,
    );
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
        'All planned tasks finished. Outputs contain the results and reported checks. External outcomes such as customers, deployment or revenue are achieved only if separately evidenced.',
      );
    }
  }
  claim(agentId?: string) {
    if (
      this.conferences.size +
        this.planners.size +
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
      agent: (this.project(task.projectId).team || this.state.agents).find(
        (a) => a.id === task.agentId,
      ),
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
