import { EventEmitter } from 'node:events';
import { AGENT_IDS, expandTeam, type OfficeCapacity } from '../shared/team.js';
import type { IdeaProposal, ProjectIdea } from '../shared/ideas.js';
import { agentContext } from '../shared/agent-context.js';
import { planDefinition } from '../shared/plan-definition.js';
import { isDirection, projectKnowledge } from './knowledge.js';
import { deliveryPlanIssues } from './delivery-plan.js';
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
import { projectUpdateSchema } from '../shared/projects.js';
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
    public action?: 'connections',
  ) {
    super(message);
  }
}

export class Engine extends EventEmitter {
  private connectionChange?: string;
  private connectionChangeOwner?: string;
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
      connectionChange: this.connectionChange,
      revision: this.store.revision,
      state: {
        ...this.state,
        projectMessages: [...(this.state.projectMessages || [])]
          .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
          .slice(0, 200)
          .sort((a, b) => a.createdAt - b.createdAt),
        ideas: [...(this.state.ideas || [])]
          .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
          .slice(0, 200)
          .sort((a, b) => a.createdAt - b.createdAt),
        memory: (this.state.memory || []).map((m) => ({
          ...m,
          stale: !memoryCurrent(m, this.state.tasks),
        })),
      },
      runtime: runtimeInfo(this.state.projects),
      attempts: this.store.recentAttempts(),
      usage: this.store.usageSummary(),
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
    references?: Pick<Activity, 'taskId' | 'sourceTaskId'>,
  ) {
    const activity: Activity = {
      id: randomUUID(),
      projectId,
      agentId,
      targetAgentId,
      ...references,
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
      exploration?: 'focused' | 'expansive';
      requestTimeoutSeconds?: number;
      deliveryMode?: 'build' | 'design';
      reasoningEffort: ReasoningEffort;
      meetingPolicy: { enabled: boolean; everyTasks: number };
    },
    officeCapacity: OfficeCapacity = 4,
    selectedTeam?: Agent[],
  ) {
    const existing = requestId && this.state.projects.find((p) => p.id === requestId);
    if (existing) {
      if (
        existing.title !== title ||
        existing.brief !== brief ||
        existing.workflow !== workflow ||
        existing.documentPack !== documentPack ||
        existing.planning !== planning ||
        (existing.officeCapacity || 4) !== officeCapacity
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
      exploration: collaboration?.exploration || 'focused',
      requestTimeoutSeconds: collaboration?.requestTimeoutSeconds || 900,
      officeCapacity,
      deliveryMode:
        workflow === 'software'
          ? collaboration?.deliveryMode || (planning === 'template' ? undefined : 'build')
          : undefined,
      team: workflow ? projectTeam(workflow, this.state.agents) : undefined,
      model:
        this.state.provider === 'demo' || this.state.provider === 'external'
          ? undefined
          : runtimeInfo().models[this.state.provider],
    };
    if (officeCapacity > 4)
      project.team = expandTeam(project.team || this.state.agents, officeCapacity, workflow);
    if (selectedTeam) project.team = structuredClone(selectedTeam);
    stateSchema.parse({ ...this.state, projects: [...this.state.projects, project] });
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
  async restartProject(
    id: string,
    requestId: string,
    title: string,
    mode: 'replan' | 'reuse',
    officeCapacity?: OfficeCapacity,
  ) {
    this.assertConnectionsStable();
    const source = this.project(id);
    const capacity = officeCapacity || source.officeCapacity || 4;
    const previousTeam = structuredClone(source.team || this.state.agents);
    const team =
      capacity === (source.officeCapacity || 4)
        ? previousTeam
        : expandTeam(
            previousTeam.slice(0, capacity).map((agent, index) => ({ ...agent, desk: index })),
            capacity,
            source.workflow,
          );
    const existing = this.state.projects.find((p) => p.id === requestId);
    if (existing) {
      if (
        existing.restartedFrom !== id ||
        existing.title !== title ||
        existing.planning !== (mode === 'replan' ? 'ai' : 'manual') ||
        (existing.officeCapacity || 4) !== capacity
      )
        throw new AppError('This restart ID already belongs to another project.', 409);
      return existing;
    }
    if (mode === 'replan' && source.provider === 'external')
      throw new AppError('External workers require a saved task plan. Choose reuse current plan.');
    const sourceTasks = this.state.tasks.filter((t) => t.projectId === id);
    const priorTasks = planDefinition(sourceTasks);
    if (
      mode === 'reuse' &&
      priorTasks.some((task) => !team.some((agent) => agent.id === task.agentId))
    )
      throw new AppError(
        'Choose a new model-generated plan when the smaller team removes an assignment owner.',
      );
    if (mode === 'reuse' && (!priorTasks.length || priorTasks.length > policy(this.store).maxTasks))
      throw new AppError(
        'The saved plan must contain tasks and fit the task limit. Choose a new plan or adjust the limit.',
      );
    for (const task of sourceTasks.filter((t) => t.conversationPending)) {
      task.conversationPending = false;
      task.status = 'failed';
      task.error = 'Conversation response stopped for a fresh project run.';
    }
    for (const meeting of this.state.meetings || [])
      if (meeting.projectId === id && this.conferences.has(meeting.id))
        this.stopMeeting(meeting.id);
    if (source.status !== 'completed' || sourceTasks.some((t) => t.status === 'working'))
      this.pauseProject(id);
    const stillStopping = () =>
      this.planners.has(id) ||
      (this.state.meetings || []).some(
        (meeting) => meeting.projectId === id && this.conferences.has(meeting.id),
      ) ||
      sourceTasks.some((t) => this.active.has(t.id));
    for (let wait = 0; wait < 100 && stillStopping(); wait++) await delay(50);
    if (stillStopping())
      throw new AppError(
        'The previous worker is still stopping. Its work is saved. Retry restart after it stops.',
        409,
      );
    // Check idempotency again after draining: a lost response or double click
    // must not create a second run or dispatch another planner request.
    const raced = this.state.projects.find((p) => p.id === requestId);
    if (raced) {
      if (
        raced.restartedFrom !== id ||
        raced.title !== title ||
        raced.planning !== (mode === 'replan' ? 'ai' : 'manual') ||
        (raced.officeCapacity || 4) !== capacity
      )
        throw new AppError('This restart ID already belongs to another request.', 409);
      return raced;
    }
    const project: Project = {
      id: requestId,
      title,
      brief: source.brief,
      provider: source.provider,
      model: source.model,
      status: 'ready',
      createdAt: Date.now(),
      documentPack: source.documentPack,
      workflow: source.workflow,
      planning: mode === 'replan' ? 'ai' : 'manual',
      team,
      reasoningEffort: source.reasoningEffort,
      meetingPolicy: structuredClone(source.meetingPolicy),
      researchEnabled: source.researchEnabled,
      workMode: source.workMode,
      toolNetwork: source.toolNetwork,
      exploration: source.exploration,
      requestTimeoutSeconds: source.requestTimeoutSeconds,
      officeCapacity: capacity,
      deliveryMode: source.deliveryMode,
      instructionHistory: structuredClone(source.instructionHistory),
      restartedFrom: id,
    };
    if (hasProjectTools(project)) {
      project.workspaceFolder = workspaceFolder(project);
      projectWorkspace(this.store.path, project);
    }
    this.state.projects.unshift(project);
    this.event(
      project.id,
      'system',
      `Fresh run created from “${source.title}”. Earlier work, files and usage remain in the previous project. Rolling workspace request and spending limits still apply.`,
    );
    this.commit();
    if (mode === 'replan') this.startPlanning(project);
    else {
      const ids = new Map(priorTasks.map((task) => [task.id, randomUUID()]));
      this.finishPlan(
        project,
        priorTasks.map((task) => ({
          id: ids.get(task.id)!,
          projectId: project.id,
          title: task.title,
          description: task.description,
          agentId: task.agentId,
          dependencies: task.dependencies.map((dependency) => ids.get(dependency)!),
          requiresApproval: task.requiresApproval,
          readOnly: task.readOnly,
          workType: task.workType,
          acceptanceCriteria: structuredClone(task.acceptanceCriteria),
          documentKind: task.documentKind,
          status: 'queued',
          output: '',
          feedback: '',
        })),
      );
    }
    return project;
  }
  beginConnectionChange(message: string) {
    this.assertConnectionsIdle();
    const owner = randomUUID();
    this.connectionChangeOwner = owner;
    this.connectionChange = message;
    this.commit();
    return owner;
  }
  endConnectionChange(owner: string) {
    if (owner !== this.connectionChangeOwner) return;
    this.connectionChangeOwner = undefined;
    this.connectionChange = undefined;
    this.commit();
  }
  private assertConnectionsStable() {
    if (this.connectionChange)
      throw new AppError(
        this.connectionChange + ' Wait for connection setup to finish before starting work.',
        409,
        'connections',
      );
  }
  assertConnectionsIdle() {
    this.assertConnectionsStable();
    if (
      this.active.size ||
      this.planners.size ||
      this.conferences.size ||
      this.state.projects.some((p) => p.status === 'running') ||
      this.state.tasks.some((t) => t.status === 'working')
    )
      throw new AppError(
        'Pause running projects and wait for their workers to stop before changing connection credentials or signing into another account.',
        409,
      );
  }
  updateProject(id: string, input: unknown) {
    const values = projectUpdateSchema.parse(input),
      project = this.project(id);
    if (
      project.status === 'running' ||
      this.planners.has(id) ||
      this.projectMeetingActive(id) ||
      this.state.tasks.some(
        (t) => t.projectId === id && (t.status === 'working' || this.active.has(t.id)),
      )
    )
      throw new AppError(
        'Pause this project and wait for its workers to stop before editing it. Your draft is retained.',
        409,
      );
    if (values.expectedUpdatedAt !== (project.updatedAt ?? project.createdAt))
      throw new AppError(
        'This project changed since this draft was opened. Your writing is retained. Reload the saved version or copy your edits before trying again.',
        409,
      );
    if (values.title === project.title && values.brief === project.brief) return project;
    const briefChanged = values.brief !== project.brief;
    const changedAt = Math.max(Date.now(), (project.updatedAt ?? project.createdAt) + 1);
    (project.briefHistory ||= []).push({
      title: project.title,
      brief: project.brief,
      changedAt,
      reason: values.reason || 'Updated project details.',
    });
    project.title = values.title;
    project.brief = values.brief;
    project.updatedAt = changedAt;
    if (briefChanged) {
      project.briefRevision = (project.briefRevision || 0) + 1;
      for (const task of this.state.tasks.filter((t) => t.projectId === id)) delete task.recovery;
    }
    this.event(
      id,
      'system',
      briefChanged
        ? 'Project brief updated. Earlier briefs, tasks and outputs retained; review the task plan against the new goal before resuming.'
        : 'Project renamed. Existing tasks, outputs and managed folder retained.',
    );
    this.commit();
    return project;
  }
  private finishPlan(project: Project, tasks: Task[]) {
    this.state.tasks.push(...tasks);
    project.planningStatus = 'ready';
    delete project.planningError;
    project.status = 'ready';
    this.recordPlan(project);
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
    if (this.connectionChange) {
      project.planningStatus = 'failed';
      project.planningError = this.connectionChange + ' Retry planning when setup finishes.';
      project.status = 'paused';
      this.commit();
      return;
    }
    if (this.planners.has(project.id)) throw new AppError('Planning is already active.', 409);
    if (this.state.tasks.some((t) => t.projectId === project.id && !t.conversationMessageId))
      throw new AppError('Edit the existing plan instead of replacing it.');
    project.planningStartedAt = Date.now();
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
      ...this.tracing(project, 'plan', undefined, (project.team || this.state.agents)[0]?.id),
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
    if (
      this.planners.has(id) ||
      this.state.tasks.some((t) => t.projectId === id && !t.conversationMessageId)
    )
      throw new AppError('Stop planning first, or edit the existing plan.');
    project.planning = 'manual';
    this.finishPlan(project, []);
  }
  private checkRevision(actual: number | undefined, expected: number | undefined, scope: string) {
    if (expected !== undefined && expected !== (actual || 0))
      throw new AppError(
        `${scope} changed since this draft was opened. Your edits are retained. Reload the saved version or copy your changes before merging them.`,
        409,
      );
  }
  private recordPlan(project: Project) {
    project.planRevision = (project.planRevision || 0) + 1;
    this.store.recordPlan(
      project.id,
      project.planRevision,
      planDefinition(this.state.tasks.filter((task) => task.projectId === project.id)),
    );
  }
  editPlan(
    id: string,
    rows: Task[],
    toolNetwork?: boolean,
    collaboration?: unknown,
    expectedRevision?: number,
    expectedSettingsRevision?: number,
  ) {
    const project = this.project(id);
    this.checkRevision(project.planRevision, expectedRevision, 'The task plan');
    if (collaboration !== undefined || toolNetwork !== undefined)
      this.checkRevision(project.settingsRevision, expectedSettingsRevision, 'Project settings');
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
    const old = this.state.tasks.filter((t) => t.projectId === id && !t.conversationMessageId);
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
        documentKind: original?.documentKind || row.documentKind,
        conversationMessageId: original?.conversationMessageId,
        conversationPending: original?.conversationPending,
        requestedByTaskId: original?.requestedByTaskId,
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
      tasks: [
        ...this.state.tasks.filter((t) => t.projectId !== id || t.conversationMessageId),
        ...merged,
      ],
    });
    const settings =
      collaboration === undefined ? undefined : collaborationSchema.parse(collaboration);
    this.store.recordPlan(id, project.planRevision || 0, planDefinition(old));
    // Preserve task objects held by workers in other projects. Validation clones them.
    this.state.tasks = [
      ...this.state.tasks.filter((t) => t.projectId !== id || t.conversationMessageId),
      ...next.tasks.filter((t) => t.projectId === id && !t.conversationMessageId),
    ];
    if (settings) Object.assign(project, settings);
    if (hasProjectTools(project) && toolNetwork !== undefined) project.toolNetwork = toolNetwork;
    if (settings || toolNetwork !== undefined)
      project.settingsRevision = (project.settingsRevision || 0) + 1;
    project.planningStatus = 'ready';
    delete project.planningError;
    project.status = 'paused';
    this.recordPlan(project);
    this.checkCompletion(project);
    this.event(
      id,
      'system',
      `Plan saved with ${merged.length} tasks. Existing results were retained.`,
    );
    this.commit();
  }
  setProvider(provider: Provider) {
    this.assertConnectionsStable();
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
    expectedRevision?: number,
  ) {
    const p = this.project(id);
    this.checkRevision(p.settingsRevision, expectedRevision, 'Project settings');
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
    p.settingsRevision = (p.settingsRevision || 0) + 1;
    this.event(
      id,
      'system',
      `Project model set to ${provider}${p.model ? ` / ${p.model}` : ''}. Existing work and usage history retained.`,
    );
    this.commit();
  }
  updateInstructions(id: string, text: string, reason: string, expectedRevision?: number) {
    const project = this.project(id);
    this.checkRevision(project.instructionRevision, expectedRevision, 'Team instructions');
    if (
      project.status === 'running' ||
      this.planners.has(id) ||
      this.projectMeetingActive(id) ||
      this.state.tasks.some(
        (t) => t.projectId === id && (t.status === 'working' || this.active.has(t.id)),
      )
    )
      throw new AppError('Pause the project before changing team instructions.');
    for (const task of this.state.tasks.filter((t) => t.projectId === id)) delete task.recovery;
    project.instructionHistory ||= [];
    project.instructionHistory.push({ id: randomUUID(), text, reason, createdAt: Date.now() });
    project.instructionRevision = (project.instructionRevision || 0) + 1;
    this.event(
      id,
      'system',
      `Team instructions version ${project.instructionHistory.length} saved: ${reason}`,
    );
    this.commit();
  }
  updatePolicy(value: unknown, expectedRevision?: number) {
    this.checkRevision(this.state.policyRevision, expectedRevision, 'Workspace limits');
    this.state.policy = policySchema.parse(value);
    this.state.policyRevision = (this.state.policyRevision || 0) + 1;
    this.commit();
  }
  acknowledge(id: string) {
    const a = this.store.getAttempt(id);
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
    expectedRevision?: number,
  ) {
    if (projectId)
      this.checkRevision(
        this.project(projectId).teamRevision,
        expectedRevision,
        'The specialist team',
      );
    if (
      values.desk >=
      (projectId ? this.project(projectId).officeCapacity || 4 : this.state.agents.length)
    )
      throw new AppError('Choose a desk in this project’s selected office.');
    const team = projectId
      ? (this.project(projectId).team ||= structuredClone(this.state.agents))
      : this.state.agents;
    if (
      projectId &&
      (this.project(projectId).status === 'running' ||
        this.planners.has(projectId) ||
        this.state.tasks.some(
          (task) =>
            task.projectId === projectId && (task.status === 'working' || this.active.has(task.id)),
        ) ||
        this.projectMeetingActive(projectId))
    )
      throw new AppError('Pause the project before editing its team.');
    const agent = team.find((a) => a.id === id);
    if (!agent) throw new AppError('Agent not found.', 404);
    const other = team.find((a) => a.desk === values.desk && a.id !== id);
    if (other) other.desk = agent.desk;
    Object.assign(agent, {
      name: values.name,
      role: values.role,
      specialty: values.specialty,
      goal: values.goal ?? agent.goal,
      desk: values.desk,
    });
    if (projectId)
      this.project(projectId).teamRevision = (this.project(projectId).teamRevision || 0) + 1;
    this.commit();
  }
  configureTeam(id: string, capacity: OfficeCapacity, members: Agent[], expectedRevision?: number) {
    const project = this.project(id);
    this.checkRevision(project.teamRevision, expectedRevision, 'The specialist team');
    if (
      project.status === 'running' ||
      this.planners.has(id) ||
      this.projectMeetingActive(id) ||
      this.state.tasks.some((t) => t.projectId === id && this.active.has(t.id))
    )
      throw new AppError('Pause this project before changing its office or team.');
    const referenced = new Set([
      ...this.state.tasks.filter((t) => t.projectId === id).map((t) => t.agentId),
      ...(this.state.meetings || [])
        .filter((m) => m.projectId === id)
        .flatMap((m) => m.participants.map((a) => a.id)),
    ]);
    if ([...referenced].some((agentId) => !members.some((a) => a.id === agentId)))
      throw new AppError(
        'Keep teammates with saved assignments or meeting history. You can change their specialist role, or restart with a fresh team.',
      );
    stateSchema.parse({
      ...this.state,
      projects: this.state.projects.map((p) =>
        p.id === id ? { ...p, officeCapacity: capacity, team: members } : p,
      ),
    });
    project.officeCapacity = capacity;
    project.team = structuredClone(members);
    project.teamRevision = (project.teamRevision || 0) + 1;
    this.event(
      id,
      'system',
      `Saved a ${capacity}-desk office with ${members.length} specialists. Existing assignments are retained; new requests use their saved roles.`,
    );
    this.commit();
  }
  postProjectMessage(
    id: string,
    messageId: string,
    content: string,
    askCoordinator: boolean,
    options?: {
      respondAsAgentId?: string;
      kind?: 'direction' | 'question' | 'idea';
      supersedesMessageId?: string;
    },
  ) {
    const project = this.project(id);
    const responseAgent = (project.team || this.state.agents).find(
      (agent) =>
        agent.id === (options?.respondAsAgentId || (project.team || this.state.agents)[0].id),
    );
    if (!responseAgent) throw new AppError('Choose a teammate in this project.');
    const messages = (this.state.projectMessages ||= []);
    const existing = messages.find((message) => message.id === messageId);
    if (existing) {
      if (
        existing.projectId !== id ||
        existing.content !== content ||
        !!existing.responseTaskId !== askCoordinator ||
        existing.supersedesMessageId !== options?.supersedesMessageId ||
        (options?.kind && existing.kind !== options.kind) ||
        (options?.respondAsAgentId &&
          existing.responseTaskId &&
          this.task(existing.responseTaskId).agentId !== options.respondAsAgentId)
      )
        throw new AppError('This message ID belongs to different content.', 409);
      return existing;
    }
    const replaced = options?.supersedesMessageId
      ? messages.find(
          (message) =>
            message.id === options.supersedesMessageId &&
            message.projectId === id &&
            isDirection(message),
        )
      : undefined;
    if (options?.supersedesMessageId && (!replaced || options.kind !== 'direction'))
      throw new AppError('Choose an existing standing direction in this project to replace.');
    if (askCoordinator) {
      this.assertConnectionsStable();
      if (project.provider === 'external')
        throw new AppError(
          'Use Save direction for external workers; coordinator replies need a direct model connection.',
        );
    }
    const taskId = askCoordinator ? randomUUID() : undefined;
    const message = {
      id: messageId,
      projectId: id,
      content,
      createdAt: Date.now(),
      responseTaskId: taskId,
      kind: options?.kind || (askCoordinator ? 'question' : 'direction'),
      ...(options?.kind === 'direction' || (!options?.kind && !askCoordinator)
        ? { active: true }
        : {}),
      supersedesMessageId: options?.supersedesMessageId,
    };
    if (replaced) {
      replaced.active = false;
      replaced.updatedAt = Date.now();
    }
    messages.push(message);
    if (taskId) {
      const agent = responseAgent;
      this.state.tasks.unshift({
        id: taskId,
        projectId: id,
        agentId: agent.id,
        title: 'Respond to project conversation',
        description: `Answer the user's project message directly using this project's saved evidence. Provide a useful answer or a focused internal action, distinguish actual work from assumptions, and do not restart unrelated assignments. Message: ${content}\nAcceptance: address the message, cite relevant saved evidence when available, and state a concrete next step.`,
        dependencies: [],
        requiresApproval: false,
        status: 'queued',
        output: '',
        feedback: '',
        workType: 'plan',
        readOnly: true,
        conversationMessageId: messageId,
        conversationPending: true,
      });
    }
    this.event(
      id,
      'message',
      askCoordinator
        ? 'Project message saved; a coordinator response is queued.'
        : 'Project direction saved for upcoming agent requests.',
    );
    this.commit();
    if (askCoordinator) this.tick();
    return message;
  }
  setDirection(projectId: string, messageId: string, active: boolean) {
    const message = this.state.projectMessages?.find(
      (message) =>
        message.projectId === projectId && message.id === messageId && isDirection(message),
    );
    if (!message) throw new AppError('Standing direction not found.', 404);
    message.active = active;
    message.updatedAt = Date.now();
    this.event(
      projectId,
      'system',
      `Standing direction ${active ? 'activated' : 'revoked'}. Its original text remains saved.`,
    );
    this.commit();
  }
  private recordIdeas(
    project: Project,
    agent: Agent,
    proposals: IdeaProposal[],
    source: { sourceTaskId?: string; sourceMeetingId?: string },
  ) {
    const ideas = (this.state.ideas ||= []);
    for (const proposal of proposals) {
      if (
        ideas.some(
          (idea) =>
            idea.projectId === project.id &&
            idea.proposal.replace(/\s+/g, ' ').trim().toLowerCase() ===
              proposal.proposal.replace(/\s+/g, ' ').trim().toLowerCase(),
        )
      )
        continue;
      ideas.push({
        ...proposal,
        ...source,
        id: randomUUID(),
        projectId: project.id,
        status: 'proposed',
        authorAgentId: agent.id,
        authorName: agent.name,
        authorRole: agent.role,
        createdBy: 'model',
        createdAt: Date.now(),
      });
    }
  }
  addIdea(id: string, ideaId: string, proposal: IdeaProposal) {
    this.project(id);
    const ideas = (this.state.ideas ||= []);
    const existing = ideas.find((idea) => idea.id === ideaId);
    if (existing) {
      if (existing.projectId !== id || existing.proposal !== proposal.proposal)
        throw new AppError('This idea ID belongs to another proposal.', 409);
      return existing;
    }
    const idea: ProjectIdea = {
      ...proposal,
      id: ideaId,
      projectId: id,
      status: 'proposed',
      authorName: 'You',
      authorRole: 'Project owner',
      createdBy: 'user',
      createdAt: Date.now(),
    };
    ideas.push(idea);
    this.commit();
    return idea;
  }
  decideIdea(projectId: string, id: string, status: 'selected' | 'rejected' | 'proposed') {
    const idea = this.state.ideas?.find((idea) => idea.id === id && idea.projectId === projectId);
    if (!idea) throw new AppError('Idea not found.', 404);
    idea.status = status;
    idea.updatedAt = Date.now();
    this.event(
      projectId,
      'system',
      `Idea ${status}: “${idea.title}”. This decision will be supplied to upcoming agent requests.`,
    );
    this.commit();
  }
  investigateIdea(projectId: string, id: string, requestId: string, agentId: string) {
    const idea = this.state.ideas?.find((idea) => idea.id === id && idea.projectId === projectId);
    if (!idea) throw new AppError('Idea not found.', 404);
    if (idea.investigationTaskId) return this.task(idea.investigationTaskId);
    const message = this.postProjectMessage(
      projectId,
      requestId,
      `Investigate the idea “${idea.title}”. Proposal: ${idea.proposal.slice(0, 1000)}\nRationale: ${idea.rationale.slice(0, 250)}\nSuggested next step: ${idea.nextStep.slice(0, 200)}\nAssess feasibility, evidence gaps and a useful bounded next action. Do not treat this proposed idea as approved implementation or verified demand.`,
      true,
      { respondAsAgentId: agentId, kind: 'idea' },
    );
    if (idea.status !== 'selected' && idea.status !== 'rejected') idea.status = 'investigating';
    idea.investigationTaskId = message.responseTaskId;
    idea.updatedAt = Date.now();
    this.commit();
    return this.task(message.responseTaskId!);
  }
  runProject(id: string) {
    this.assertConnectionsStable();
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
      !this.state.tasks.some((t) => t.projectId === id && !t.conversationMessageId) ||
      project.planningStatus === 'planning' ||
      project.planningStatus === 'failed'
    )
      throw new AppError('Finish or retry planning before running the team. Your brief is saved.');
    if (hasProjectTools(project) && project.provider !== 'codex')
      throw new AppError(
        'Software delivery requires the Codex connection for real file and command tools. Select it in Workspace controls.',
      );
    const readiness = modelReadiness(runtimeInfo(), project.provider, project.model);
    if (!readiness.ready)
      throw new AppError(
        `This saved project uses ${project.provider}${project.model ? ' / ' + project.model : ''}. ${readiness.message}`,
        400,
        'connections',
      );
    if (hasProjectTools(project) && !runtimeInfo().coding?.ready)
      throw new AppError(
        runtimeInfo().coding?.message || 'Check coding sandbox readiness in Model connections.',
        400,
        'connections',
      );
    const mainTasks = this.state.tasks.filter(
      (task) => task.projectId === id && !task.conversationMessageId,
    );
    const definition = planDefinition(mainTasks),
      positions = new Map(definition.map((task, index) => [task.id, index]));
    const contractIssues = deliveryPlanIssues(
      project,
      definition.map((task) => ({
        ...task,
        dependencies: task.dependencies.map((id) => positions.get(id)!),
      })),
    );
    if (contractIssues.length)
      throw new AppError(
        'The saved plan does not meet the selected delivery contract. ' +
          contractIssues.join(' ') +
          ' Edit the plan or select Design only when implementation is not intended. No model request was sent.',
      );
    if (mainTasks.length && mainTasks.every((task) => task.status === 'done')) {
      this.checkCompletion(project);
      this.commit();
      throw new AppError(
        'This plan is complete. View its results, add a follow-up assignment, or restart for a fresh run.',
      );
    }
    if (
      this.state.tasks.some(
        (t) => t.projectId === id && !t.conversationMessageId && t.status === 'failed',
      ) &&
      !this.state.tasks.some(
        (t) =>
          t.projectId === id &&
          (t.status === 'working' ||
            (t.status === 'queued' &&
              t.dependencies.every((dep) => this.task(dep).status === 'done'))),
      )
    )
      throw new AppError(
        'A saved task needs attention before this project can progress. Retry that task, recover its saved result, or use Restart project for a fresh run.',
      );
    if (
      this.state.tasks.filter((t) => t.projectId === id && !t.conversationMessageId).length >
      policy(this.store).maxTasks
    )
      throw new AppError(
        `This plan has ${this.state.tasks.filter((task) => task.projectId === id && !task.conversationMessageId).length} tasks; Tasks allowed per project is ${policy(this.store).maxTasks}. Increase it in Workspace controls; no tasks have been discarded.`,
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
    if (
      project.status === 'completed' &&
      !this.state.tasks.some((t) => t.projectId === id && t.status === 'working')
    )
      throw new AppError('This project is already complete.');
    project.status = 'paused';
    for (const task of this.state.tasks.filter(
      (t) => t.projectId === id && t.conversationPending,
    )) {
      task.conversationPending = false;
      task.status = 'failed';
      task.error = 'Coordinator response paused. Retry this saved task when ready.';
    }
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
    this.assertConnectionsStable();
    const task = this.task(id);
    if (task.status !== 'failed') throw new AppError('Only failed tasks can be retried.');
    if (this.active.has(id))
      throw new AppError('Wait for the cancelled worker to stop before retrying.');
    if (this.store.hasUncertain('task_id', id))
      throw new AppError('Acknowledge uncertain usage in Workspace controls before retrying.');
    const target = this.project(task.projectId);
    if (
      !task.conversationMessageId &&
      (this.state.meetings || []).some((m) => m.projectId === target.id && m.status === 'failed')
    )
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
    if (task.conversationMessageId) task.conversationPending = true;
    else
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
    this.assertConnectionsStable();
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
        `The revision limit is reached: this task has used ${task.revisions || 0} of ${policy(this.store).maxRevisions} revisions. Increase Revisions allowed per task in Workspace controls before requesting another revision.`,
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
    if (task.conversationMessageId && task.status === 'queued') task.conversationPending = true;
    if (!task.conversationMessageId && project.status !== 'paused')
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
  configureCollaboration(
    id: string,
    value: unknown,
    expectedRevision?: number,
    toolNetwork?: boolean,
  ) {
    const project = this.project(id);
    this.checkRevision(project.settingsRevision, expectedRevision, 'Project settings');
    if (
      project.status === 'running' ||
      this.state.tasks.some((t) => t.projectId === id && this.active.has(t.id)) ||
      this.planners.has(id) ||
      this.projectMeetingActive(id)
    )
      throw new AppError('Pause this project before changing collaboration settings.');
    Object.assign(project, collaborationSchema.parse(value));
    if (hasProjectTools(project) && toolNetwork !== undefined) project.toolNetwork = toolNetwork;
    project.settingsRevision = (project.settingsRevision || 0) + 1;
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
  startMeeting(
    projectId: string,
    agenda: string,
    trigger: Meeting['trigger'] = 'manual',
    participantIds?: string[],
  ) {
    this.assertConnectionsStable();
    const project = this.project(projectId);
    if (
      this.planners.has(projectId) ||
      this.projectMeetingActive(projectId) ||
      this.state.tasks.some(
        (t) => t.projectId === projectId && (t.status === 'working' || this.active.has(t.id)),
      ) ||
      this.conferences.size +
        this.planners.size +
        this.state.tasks.filter((t) => t.status === 'working').length >=
        policy(this.store).maxConcurrent
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
    const team = project.team || this.state.agents;
    if (
      participantIds &&
      (!participantIds.length ||
        new Set(participantIds).size !== participantIds.length ||
        participantIds.some((id) => !team.some((agent) => agent.id === id)))
    )
      throw new AppError('Choose at least one unique teammate from this project.');
    const meeting: Meeting = {
      id: randomUUID(),
      projectId,
      agenda,
      trigger,
      status: 'gathering',
      checkpoint: this.state.tasks.filter(
        (t) => t.projectId === projectId && t.status === 'done' && !t.conversationMessageId,
      ).length,
      participants: structuredClone(
        participantIds ? participantIds.map((id) => team.find((agent) => agent.id === id)!) : team,
      ),
      contributions: [],
      summary: '',
      createdAt: Date.now(),
    };
    (this.state.meetings ||= []).push(meeting);
    this.launchMeeting(meeting);
    return meeting;
  }
  retryMeeting(id: string) {
    this.assertConnectionsStable();
    const meeting = this.meeting(id);
    if (meeting.status !== 'failed') throw new AppError('Only failed meetings can be retried.');
    if (
      this.planners.has(meeting.projectId) ||
      this.projectMeetingActive(meeting.projectId) ||
      this.state.tasks.some(
        (t) =>
          t.projectId === meeting.projectId && (t.status === 'working' || this.active.has(t.id)),
      ) ||
      this.conferences.size +
        this.planners.size +
        this.state.tasks.filter((t) => t.status === 'working').length >=
        policy(this.store).maxConcurrent
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
    meeting.startedAt = Date.now();
    delete meeting.error;
    this.event(
      project.id,
      'system',
      `Team gathering for ${meeting.trigger === 'kickoff' ? 'kickoff' : 'a project meeting'}: ${meeting.agenda}`,
    );
    this.commit();
    void (async () => {
      try {
        await delay(this.gatherMs * Math.max(1, meeting.participants.length / 4), undefined, {
          signal: controller.signal,
        });
        meeting.status = 'running';
        this.commit();
        for (const agent of meeting.participants) {
          if (meeting.contributions.some((c) => c.agentId === agent.id)) continue;
          meeting.speakerId = agent.id;
          this.commit();
          if (project.provider === 'demo')
            await delay(Math.min(1500, this.stepMs / 2), undefined, { signal: controller.signal });
          const proposals: IdeaProposal[] = [];
          const content = await this.discuss(project, meeting, agent, false, {
            store: this.store,
            project,
            signal: controller.signal,
            onIdea: (idea) => proposals.push(idea),
            ...this.tracing(project, 'meeting', undefined, agent.id, meeting.id),
          });
          if (controller.signal.aborted) return;
          this.recordIdeas(project, agent, proposals, { sourceMeetingId: meeting.id });
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
        let actions: { taskId: string; action: string }[] = [];
        const summary = await this.discuss(project, meeting, meeting.participants[0], true, {
          store: this.store,
          project,
          signal: controller.signal,
          onMeetingActions: (value) => {
            actions = value;
          },
          ...this.tracing(project, 'meeting', undefined, meeting.participants[0].id, meeting.id),
        });
        if (controller.signal.aborted) return;
        meeting.actions = actions.map((action, index) => {
          const task = this.state.tasks.find(
            (task) =>
              task.id === action.taskId &&
              task.projectId === project.id &&
              ['queued', 'failed'].includes(task.status),
          );
          const id = `m_${meeting.id.replaceAll('-', '')}_${index}`;
          if (!task || (task.acceptanceCriteria?.length || 0) >= 10)
            return {
              id,
              action: action.action,
              taskId: task?.id,
              agentId: task?.agentId,
              status: 'proposed' as const,
            };
          const evidence = hasProjectTools(project)
            ? task.workType === 'review'
              ? 'inspection'
              : ['implementation', 'tests'].includes(task.workType || '')
                ? 'verification'
                : 'report'
            : 'report';
          (task.acceptanceCriteria ||= []).push({
            id,
            description: action.action.slice(0, 240),
            evidence,
          });
          (task.dynamicCriteriaIds ||= []).push(id);
          delete task.recovery;
          project.planRevision = (project.planRevision || 0) + 1;
          return {
            id,
            action: action.action,
            taskId: task.id,
            agentId: task.agentId,
            criterionId: id,
            status: 'assigned' as const,
          };
        });
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
      this.conferences.size +
        this.planners.size +
        this.state.tasks.filter((t) => t.status === 'working').length >=
      policy(this.store).maxConcurrent
    )
      return;
    for (const project of this.state.projects) {
      if (
        project.status !== 'running' ||
        this.planners.has(project.id) ||
        this.state.tasks.some(
          (t) => t.projectId === project.id && (t.status === 'working' || this.active.has(t.id)),
        ) ||
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
      const tasks = this.state.tasks.filter(
          (t) => t.projectId === project.id && !t.conversationMessageId,
        ),
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
      !this.projectMeetingActive(task.projectId) &&
      (!!task.conversationMessageId ||
        !(this.state.meetings || []).some(
          (m) => m.projectId === task.projectId && m.status === 'failed',
        )) &&
      task.status === 'queued' &&
      !(
        hasProjectTools(this.project(task.projectId)) &&
        this.state.tasks.some((t) => t.projectId === task.projectId && t.status === 'working')
      ) &&
      (['running', 'needs_input'].includes(this.project(task.projectId).status) ||
        !!task.conversationPending) &&
      task.dependencies.every((id) => this.task(id).status === 'done') &&
      !this.state.tasks.some(
        (t) =>
          t.projectId === task.projectId && t.agentId === task.agentId && t.status === 'working',
      )
    );
  }
  tick() {
    if (this.connectionChange) return;
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
    task.conversationPending = false;
    task.status = 'working';
    task.startedAt = Date.now();
    task.lastAttemptStartedAt = task.startedAt;
    task.briefRevision = this.project(task.projectId).briefRevision || 0;
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
    for (const previous of task.dependencies.map((id) => this.task(id)))
      this.event(
        task.projectId,
        'message',
        `Dependency completed: “${previous.title}”. Its saved result is available to this assignment.`,
        previous.agentId,
        task.agentId,
        { taskId: task.id, sourceTaskId: previous.id },
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
        (t) =>
          t.projectId === project.id && (t.status === 'done' || t.id === task.requestedByTaskId),
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
          readOnly: !!task.readOnly || project.deliveryMode === 'design',
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
        this.recordIdeas(project, agent, task.result?.ideas || [], { sourceTaskId: task.id });
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
    for (const meeting of this.state.meetings || [])
      for (const action of meeting.actions || []) {
        const check = task.result?.checks.find(
          (check) => check.criterion.startsWith(`${action.criterionId}:`) && check.status === 'met',
        );
        if (task.status === 'done' && action.taskId === task.id && check) {
          action.status = 'addressed';
          action.evidence = check.evidence;
        }
      }
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
    const team = this.project(task.projectId).team || this.state.agents;
    if (followUps.some((followUp) => !team.some((agent) => agent.id === followUp.agentId)))
      throw new AppError(
        'A specialist follow-up named an agent outside this project’s team. The proposed work is saved; correct the owner before retrying.',
      );
    const limits = policy(this.store);
    if ((task.coordinationRounds || 0) >= limits.maxRevisions)
      throw new AppError(
        'The internal follow-up limit was reached. The partial work is saved; inspect the outstanding checks before extending the plan or revision limit.',
      );
    if (
      this.state.tasks.filter(
        (t) =>
          t.projectId === task.projectId &&
          (task.conversationMessageId
            ? t.conversationMessageId === task.conversationMessageId
            : !t.conversationMessageId),
      ).length +
        followUps.length >
      limits.maxTasks
    )
      throw new AppError(
        'Necessary teammate follow-ups exceed the project task limit. The proposed work is saved in this task; extend the plan or task limit before retrying.',
      );
    let dependencies = [...task.dependencies];
    const created: Task[] = followUps.map((f) => {
      const project = this.project(task.projectId),
        owner = team.find((agent) => agent.id === f.agentId)!;
      const tools = project.provider === 'codex' && hasProjectTools(project);
      const workType =
        f.workType ||
        (!tools
          ? 'plan'
          : /review|quality/.test(owner.role.toLowerCase())
            ? 'review'
            : /test/.test(owner.role.toLowerCase())
              ? 'tests'
              : !task.readOnly && /engineer|developer/.test(owner.role.toLowerCase())
                ? 'implementation'
                : 'plan');
      if (
        (!tools &&
          (workType !== 'plan' || f.acceptanceCriteria?.some((c) => c.evidence !== 'report'))) ||
        (task.readOnly && workType === 'implementation')
      )
        throw new AppError(
          'The proposed follow-up requires tools or write access unavailable to this assignment. Its proposal is saved; use a separately authorized implementation assignment or select the required project tools.',
        );
      const acceptanceCriteria = structuredClone(f.acceptanceCriteria || []);
      const required =
        workType === 'implementation'
          ? ['artifact', 'verification']
          : workType === 'review'
            ? ['inspection']
            : workType === 'tests'
              ? ['verification']
              : ['report'];
      for (const evidence of required)
        if (!acceptanceCriteria.some((c) => c.evidence === evidence)) {
          let index = 1;
          while (acceptanceCriteria.some((c) => c.id === `auto${index}`)) index++;
          if (acceptanceCriteria.length >= 10)
            throw new AppError(
              'The follow-up needs an acceptance check for ' +
                evidence +
                '. Correct its proposed criteria before retrying.',
            );
          acceptanceCriteria.push({
            id: `auto${index}`,
            description:
              evidence === 'verification'
                ? 'Execute meaningful checks of the assigned behavior.'
                : f.description.slice(0, 300),
            evidence: evidence as 'artifact' | 'verification' | 'inspection' | 'report',
          });
        }
      const next: Task = {
        ...f,
        id: randomUUID(),
        projectId: task.projectId,
        requestedByTaskId: task.id,
        conversationMessageId: task.conversationMessageId,
        conversationPending: !!task.conversationMessageId,
        readOnly: !!task.readOnly || !!f.readOnly || workType === 'plan' || workType === 'review',
        workType,
        acceptanceCriteria,
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
    const project = this.project(task.projectId);
    project.planRevision = (project.planRevision || 0) + 1;
    task.status = 'queued';
    if (task.conversationMessageId) task.conversationPending = true;
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
    const author = (project.team || this.state.agents).find((agent) => agent.id === task.agentId)!;
    this.recordIdeas(project, author, task.result?.ideas || [], { sourceTaskId: task.id });
    for (const idea of (this.state.ideas || []).filter(
      (idea) => idea.investigationTaskId === task.id,
    )) {
      if (idea.status === 'investigating') idea.status = 'evaluated';
      idea.evaluation = (task.result?.summary || output).slice(0, 1200);
      idea.updatedAt = Date.now();
    }
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
      if (!task.conversationMessageId && project.status !== 'paused')
        project.status = 'needs_input';
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
    if (!task.conversationMessageId) this.project(task.projectId).status = 'paused';
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
    const tasks = this.state.tasks.filter(
      (t) => t.projectId === project.id && !t.conversationMessageId,
    );
    if (tasks.length && tasks.every((t) => t.status === 'done') && project.status !== 'completed') {
      project.status = 'completed';
      this.event(
        project.id,
        'system',
        'All planned tasks finished. Outputs contain the results and reported checks. External outcomes such as customers, deployment or revenue are achieved only if separately evidenced.',
      );
    }
  }
  claim(agentId?: string) {
    if (this.connectionChange) return null;
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
      agentContext: agentContext(
        this.project(task.projectId),
        (this.project(task.projectId).team || this.state.agents).find(
          (agent) => agent.id === task.agentId,
        )!,
        task,
      ),
      projectConversation: (this.state.projectMessages || [])
        .filter((message) => message.projectId === task.projectId)
        .slice(-12),
      knowledge: projectKnowledge(this.project(task.projectId), this.state),
      ideaBoard: (this.state.ideas || [])
        .filter((idea) => idea.projectId === task.projectId)
        .slice(-12),
      agent: (this.project(task.projectId).team || this.state.agents).find(
        (a) => a.id === task.agentId,
      ),
      project: this.project(task.projectId),
      context: relevantContext(
        task,
        this.state.tasks.filter(
          (t) =>
            t.projectId === task.projectId &&
            (t.status === 'done' || t.id === task.requestedByTaskId),
        ),
      ),
      memory: selectedMemory(this.store, task.projectId),
      limits: {
        maxOutputTokens: policy(this.store).maxOutputTokens,
        maxInputBytes: policy(this.store).maxInputBytes,
        localContextTokens: policy(this.store).localContextTokens ?? 32768,
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
