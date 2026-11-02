import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Observation } from '../shared/verification.js';
import type { Activity, Attempt, WorkspaceState } from '../shared/types.js';
import { defaultPolicy, backupSchema, stateSchema } from '../shared/schemas.js';
import { initialState } from './seed.js';
import { CONSOLE_LIMITS, type ConsoleEntry } from '../shared/console.js';
import { consoleText } from './console.js';
import type { PlanTask } from '../shared/plan-definition.js';

export class Store {
  private db: DatabaseSync;
  state: WorkspaceState;
  revision = 0;
  private journalSignatures = new Map<string, string>();
  private pendingPlans = new Map<
    string,
    { projectId: string; revision: number; createdAt: number; tasks: PlanTask[] }
  >();
  constructor(public path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, output TEXT NOT NULL)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS console_entries (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS console_project ON console_entries(project_id, sequence)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS activity_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS activity_project ON activity_events(project_id, sequence); CREATE INDEX IF NOT EXISTS activity_type ON activity_events(project_id, type, sequence); CREATE TABLE IF NOT EXISTS attempt_results (attempt_id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS plan_versions (project_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id, revision))',
    );
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(attempts)').all() as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    for (const [name, type] of Object.entries({
      created_at: 'INTEGER',
      status: 'TEXT',
      project_id: 'TEXT',
      task_id: 'TEXT',
      meeting_id: 'TEXT',
      reserved_usd: 'REAL',
      actual_usd: 'REAL',
    }))
      if (!columns.has(name)) this.db.exec(`ALTER TABLE attempts ADD COLUMN ${name} ${type}`);
    this.db.exec(
      "UPDATE attempts SET created_at=json_extract(payload,'$.createdAt'), status=json_extract(payload,'$.status'), project_id=json_extract(payload,'$.projectId'), task_id=json_extract(payload,'$.taskId'), meeting_id=json_extract(payload,'$.meetingId'), reserved_usd=json_extract(payload,'$.reservedUsd'), actual_usd=json_extract(payload,'$.actualUsd') WHERE created_at IS NULL",
    );
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS attempts_created ON attempts(created_at DESC,id DESC); CREATE INDEX IF NOT EXISTS attempts_status ON attempts(status,created_at DESC,id DESC); CREATE INDEX IF NOT EXISTS attempts_task ON attempts(task_id,status); CREATE INDEX IF NOT EXISTS attempts_meeting ON attempts(meeting_id,status); CREATE INDEX IF NOT EXISTS attempts_project ON attempts(project_id,created_at)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS project_journal (kind TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS journal_page ON project_journal(kind,project_id,created_at DESC,id DESC)',
    );
    const row = this.db.prepare('SELECT payload FROM workspace WHERE id=1').get() as
      { payload: string } | undefined;
    this.state = row ? JSON.parse(row.payload) : initialState(process.env.WORKROOM_DEMO === '1');
    if (row && (this.state.schemaVersion || 1) < 6) this.snapshot('before-upgrade');
    this.state.schemaVersion = 6;
    if (
      this.state.policy?.maxTasks === 6 &&
      Object.entries(defaultPolicy).every(
        ([key, value]) =>
          key === 'maxTasks' ||
          JSON.stringify(this.state.policy![key as keyof typeof defaultPolicy]) ===
            JSON.stringify(value),
      )
    )
      this.state.policy.maxTasks = defaultPolicy.maxTasks;
    for (const [kind, field] of [
      ['message', 'projectMessages'],
      ['idea', 'ideas'],
    ] as const) {
      const records = new Map((this.state[field] || []).map((record) => [record.id, record]));
      for (const row of this.db
        .prepare('SELECT payload FROM project_journal WHERE kind=? ORDER BY created_at,id')
        .all(kind) as { payload: string }[]) {
        const record = JSON.parse(row.payload);
        records.set(record.id, record);
        this.journalSignatures.set(`${kind}:${record.id}`, row.payload);
      }
      (this.state as any)[field] = [...records.values()].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );
    }
    this.state.policy ||= structuredClone(defaultPolicy);
    this.state.memory ||= [];
    this.state.meetings ||= [];
    const palette: Record<string, string> = {
      '#8c9cf5': '#5285b5',
      '#f1b94b': '#bd914b',
      '#68b49b': '#428578',
      '#d28ba8': '#ad6b50',
    };
    for (const agent of this.state.agents) agent.color = palette[agent.color] || agent.color;
    for (const a of this.attempts())
      if (a.status === 'running')
        this.putAttempt({
          ...a,
          status: 'uncertain',
          error: 'Interrupted by a server restart. Review before retrying.',
        });
    for (const task of this.state.tasks)
      if (task.status === 'working') {
        // Any dispatched work requires explicit recovery, even when usage was confirmed.
        // A completed receipt alone must never requeue tool work or consume another request.
        const attempt = task.attemptId ? this.getAttempt(task.attemptId) : undefined;
        task.status = 'failed';
        task.error = 'Interrupted work needs review before retrying. No request was replayed.';
        if (attempt) {
          const response = this.attemptResult(attempt.id);
          task.recovery = {
            attemptId: attempt.id,
            hasResponse: !!response && !response.outputLimitReached,
          };
          task.error = response
            ? 'A model reply was saved before interruption. Recover the saved result without another model request, or inspect it before retrying.'
            : 'Interrupted work may have consumed usage. Review Usage and existing files before explicitly retrying.';
        }
        delete task.leaseId;
        delete task.leaseExpiresAt;
      }
    this.recoverProjects(this.state);
    this.save();
  }
  attempts(): Attempt[] {
    return (this.db.prepare('SELECT payload FROM attempts').all() as { payload: string }[]).map(
      (r) => JSON.parse(r.payload),
    );
  }
  recordPlan(projectId: string, revision: number, tasks: PlanTask[]) {
    this.pendingPlans.set(`${projectId}:${revision}`, {
      projectId,
      revision,
      tasks: structuredClone(tasks),
      createdAt: Date.now(),
    });
  }
  planVersions(projectId: string, before = Number.MAX_SAFE_INTEGER) {
    return (
      this.db
        .prepare(
          'SELECT payload FROM plan_versions WHERE project_id=? AND revision<? ORDER BY revision DESC LIMIT 20',
        )
        .all(projectId, before) as { payload: string }[]
    ).map((row) => JSON.parse(row.payload));
  }
  consoleEntries(projectId: string): ConsoleEntry[] {
    return (
      this.db
        .prepare(
          'SELECT sequence, payload FROM console_entries WHERE project_id=? ORDER BY sequence',
        )
        .all(projectId) as { sequence: number; payload: string }[]
    ).map((r) => ({ ...JSON.parse(r.payload), sequence: r.sequence }));
  }
  putConsole(input: Omit<ConsoleEntry, 'sequence' | 'createdAt' | 'updatedAt'>) {
    const existing = this.db
      .prepare('SELECT payload FROM console_entries WHERE id=?')
      .get(input.id) as { payload: string } | undefined;
    const entry = {
      ...input,
      ...Object.fromEntries(
        ['taskTitle', 'agentName', 'agentRole', 'model']
          .filter((key) => typeof input[key as keyof typeof input] === 'string')
          .map((key) => [key, consoleText(input[key as keyof typeof input] as string).text]),
      ),
      ...consoleText(input.text),
      createdAt: existing ? JSON.parse(existing.payload).createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    const row = this.db
      .prepare(
        'INSERT OR REPLACE INTO console_entries(id,project_id,payload) VALUES(?,?,?) RETURNING sequence',
      )
      .get(entry.id, entry.projectId, JSON.stringify(entry)) as { sequence: number };
    const removed: string[] = [];
    const trim = (projectId?: string) => {
      const rows = this.db
        .prepare(
          `SELECT sequence,id,length(payload) AS length FROM console_entries ${projectId ? 'WHERE project_id=?' : ''} ORDER BY sequence DESC`,
        )
        .all(...(projectId ? [projectId] : [])) as {
        sequence: number;
        id: string;
        length: number;
      }[];
      let characters = 0;
      rows.forEach((r, i) => {
        characters += r.length;
        if (
          i >= (projectId ? CONSOLE_LIMITS.projectEntries : CONSOLE_LIMITS.workspaceEntries) ||
          characters >
            (projectId ? CONSOLE_LIMITS.projectCharacters : CONSOLE_LIMITS.workspaceCharacters)
        ) {
          this.db.prepare('DELETE FROM console_entries WHERE sequence=?').run(r.sequence);
          removed.push(r.id);
        }
      });
    };
    trim(entry.projectId);
    trim();
    return { entry: { ...entry, sequence: row.sequence }, removed };
  }
  putAttempt(attempt: Attempt) {
    this.db
      .prepare(
        `INSERT INTO attempts(id,payload,created_at,status,project_id,task_id,meeting_id,reserved_usd,actual_usd) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at,status=excluded.status,project_id=excluded.project_id,task_id=excluded.task_id,meeting_id=excluded.meeting_id,reserved_usd=excluded.reserved_usd,actual_usd=excluded.actual_usd`,
      )
      .run(
        attempt.id,
        JSON.stringify(attempt),
        attempt.createdAt,
        attempt.status,
        attempt.projectId,
        attempt.taskId || null,
        attempt.meetingId || null,
        attempt.reservedUsd,
        attempt.actualUsd ?? null,
      );
  }
  getAttempt(id: string): Attempt | undefined {
    const row = this.db.prepare('SELECT payload FROM attempts WHERE id=?').get(id) as
      { payload: string } | undefined;
    return row && JSON.parse(row.payload);
  }
  hasUncertain(field: 'task_id' | 'meeting_id', id: string) {
    return !!this.db
      .prepare(`SELECT 1 FROM attempts WHERE ${field}=? AND status='uncertain' LIMIT 1`)
      .get(id);
  }
  usageSummary(projectId = '') {
    const day = this.db
      .prepare(
        "SELECT COUNT(*) AS requests24h,COALESCE(SUM(COALESCE(actual_usd,reserved_usd)),0) AS cost24h FROM attempts WHERE created_at>=? AND status!='cached'",
      )
      .get(Date.now() - 86400000) as { requests24h: number; cost24h: number };
    const states = this.db
      .prepare(
        "SELECT SUM(status='uncertain') AS uncertain,SUM(status='running') AS running FROM attempts",
      )
      .get() as { uncertain: number; running: number };
    const cost = this.db
      .prepare(
        'SELECT COALESCE(SUM(COALESCE(actual_usd,reserved_usd)),0) AS cost FROM attempts WHERE project_id=?',
      )
      .get(projectId) as { cost: number };
    return {
      ...day,
      uncertain: states.uncertain || 0,
      running: states.running || 0,
      projectCost: cost.cost,
    };
  }
  private cursor(before?: string): [number, string] {
    if (!before) return [Number.MAX_SAFE_INTEGER, '\uffff'];
    let value;
    try {
      value = JSON.parse(Buffer.from(before, 'base64url').toString());
    } catch {
      throw new Error('Invalid history cursor.');
    }
    if (
      !Array.isArray(value) ||
      !Number.isFinite(value[0]) ||
      typeof value[1] !== 'string' ||
      value[1].length > 100
    )
      throw new Error('Invalid history cursor.');
    return [value[0], value[1]];
  }
  attemptsPage(
    options: {
      before?: string;
      status?: string;
      projectId?: string;
      taskId?: string;
      limit?: number;
    } = {},
  ) {
    const [time, id] = this.cursor(options.before),
      where = ['(created_at<? OR (created_at=? AND id<?))'],
      params: any[] = [time, time, id];
    for (const [field, value] of [
      ['status', options.status],
      ['project_id', options.projectId],
      ['task_id', options.taskId],
    ])
      if (value) {
        where.push(`${field}=?`);
        params.push(value);
      }
    const limit = Math.min(500, Math.max(1, options.limit || 50));
    const rows = this.db
      .prepare(
        `SELECT payload FROM attempts WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as { payload: string }[];
    const entries = rows.slice(0, limit).map((row) => JSON.parse(row.payload) as Attempt),
      last = entries.at(-1);
    return {
      entries,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url')
          : null,
    };
  }
  recentAttempts() {
    const rows = [
      ...this.attemptsPage({ limit: 500 }).entries,
      ...this.attemptsPage({ status: 'uncertain', limit: 100 }).entries,
    ];
    return [...new Map(rows.map((row) => [row.id, row])).values()].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }
  historyPage(kind: 'message' | 'idea', projectId: string, before?: string, limit = 50) {
    const [time, id] = this.cursor(before);
    const rows = this.db
      .prepare(
        'SELECT payload FROM project_journal WHERE kind=? AND project_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?',
      )
      .all(kind, projectId, time, time, id, limit + 1) as { payload: string }[];
    const entries = rows.slice(0, limit).map((row) => JSON.parse(row.payload)),
      last = entries.at(-1);
    return {
      entries,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url')
          : null,
    };
  }
  private saveJournals(state: WorkspaceState) {
    const changed = new Map<string, string>();
    for (const [kind, field] of [
      ['message', 'projectMessages'],
      ['idea', 'ideas'],
    ] as const)
      for (const record of state[field] || []) {
        const key = `${kind}:${record.id}`,
          payload = JSON.stringify(record);
        if (this.journalSignatures.get(key) === payload) continue;
        this.db
          .prepare(
            'INSERT INTO project_journal VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload',
          )
          .run(kind, record.id, record.projectId, record.createdAt, payload);
        changed.set(key, payload);
      }
    return changed;
  }
  private payload(state: WorkspaceState) {
    return JSON.stringify({ ...state, projectMessages: [], ideas: [] });
  }

  completeAttempt(
    attempt: Attempt,
    result: { text: string; outputLimitReached?: boolean; observations?: Observation[] },
  ) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO attempt_results VALUES(?,?)')
        .run(attempt.id, JSON.stringify(result));
      this.putAttempt(attempt);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  attemptResult(
    id: string,
  ): { text: string; outputLimitReached?: boolean; observations?: Observation[] } | undefined {
    const row = this.db
      .prepare('SELECT payload FROM attempt_results WHERE attempt_id=?')
      .get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  recordActivity(activity: Activity) {
    this.db
      .prepare('INSERT OR IGNORE INTO activity_events(id,project_id,type,payload) VALUES(?,?,?,?)')
      .run(activity.id, activity.projectId, activity.type, JSON.stringify(activity));
  }
  activityPage(projectId: string, before?: number, type?: string, limit = 100) {
    const rows = this.db
      .prepare(
        `SELECT sequence,payload FROM activity_events WHERE project_id=? AND sequence<? ${type ? 'AND type=?' : ''} ORDER BY sequence DESC LIMIT ?`,
      )
      .all(projectId, before ?? Number.MAX_SAFE_INTEGER, ...(type ? [type] : []), limit + 1) as {
      sequence: number;
      payload: string;
    }[];
    const page = rows.slice(0, limit);
    return {
      entries: page.map((r) => JSON.parse(r.payload) as Activity),
      nextCursor: rows.length > limit ? page.at(-1)!.sequence : null,
    };
  }
  private activityHistory(): Activity[] {
    return (
      this.db.prepare('SELECT payload FROM activity_events ORDER BY sequence DESC').all() as {
        payload: string;
      }[]
    ).map((r) => JSON.parse(r.payload));
  }
  cached(key: string) {
    return (
      this.db.prepare('SELECT output FROM cache WHERE key=?').get(key) as
        { output: string } | undefined
    )?.output;
  }
  cache(key: string, output: string) {
    this.db
      .prepare(
        'INSERT INTO cache(key,output) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET output=excluded.output',
      )
      .run(key, output);
  }
  backup() {
    const history = new Map(this.activityHistory().map((a) => [a.id, a]));
    for (const a of this.state.activities) history.set(a.id, a);
    return backupSchema.parse({
      format: 'workroom',
      version: 2,
      createdAt: Date.now(),
      state: { ...structuredClone(this.state), activities: this.state.activities.slice(0, 250) },
      attempts: this.attempts(),
      attemptResults: (
        this.db.prepare('SELECT attempt_id,payload FROM attempt_results').all() as {
          attempt_id: string;
          payload: string;
        }[]
      ).map((r) => ({ attemptId: r.attempt_id, ...JSON.parse(r.payload) })),
      activityHistory: [...history.values()].sort((a, b) => b.createdAt - a.createdAt),
      planHistory: (
        this.db.prepare('SELECT payload FROM plan_versions ORDER BY project_id,revision').all() as {
          payload: string;
        }[]
      ).map((row) => JSON.parse(row.payload)),
    });
  }
  snapshot(label: string) {
    if (this.path === ':memory:') return;
    const folder = join(dirname(this.path), 'backups');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`),
      JSON.stringify(this.backup()),
      { flag: 'wx', mode: 0o600 },
    );
  }
  restore(input: unknown) {
    const parsed = backupSchema.parse(input);
    // Validate all state before touching the current workspace. Old single-state
    // snapshots can be imported through the same validated envelope.
    stateSchema.parse(parsed.state);
    this.snapshot('before-restore');
    const existing = new Map(this.attempts().map((a) => [a.id, a]));
    for (const a of parsed.attempts)
      if (!existing.has(a.id))
        existing.set(a.id, { ...a, status: a.status === 'running' ? 'uncertain' : a.status });
    const restored = structuredClone(parsed.state);
    restored.schemaVersion = 6;
    // A restore must invalidate open editors, even when the imported counters
    // happen to match an older browser draft (an otherwise silent stale write).
    restored.policyRevision =
      Math.max(this.state.policyRevision || 0, restored.policyRevision || 0) + 1;
    for (const project of restored.projects) {
      const previous = this.state.projects.find((previous) => previous.id === project.id);
      for (const field of [
        'planRevision',
        'teamRevision',
        'settingsRevision',
        'instructionRevision',
      ] as const)
        project[field] = Math.max(project[field] || 0, previous?.[field] || 0) + 1;
      project.updatedAt = Math.max(
        Date.now(),
        (project.updatedAt || project.createdAt) + 1,
        (previous?.updatedAt || previous?.createdAt || 0) + 1,
      );
    }
    restored.policy = { ...structuredClone(defaultPolicy), ...restored.policy, allowPaid: false };
    restored.memory ||= [];
    this.recoverProjects(restored);
    for (const t of restored.tasks)
      if (t.status === 'working') {
        t.status = 'failed';
        t.error = 'Restored in-flight work needs review before retry.';
        const receipt = parsed.attempts.find(
          (a) => a.id === t.attemptId && a.projectId === t.projectId && a.taskId === t.id,
        );
        const response = parsed.attemptResults?.find((r) => r.attemptId === receipt?.id);
        if (receipt)
          t.recovery = {
            attemptId: receipt.id,
            hasResponse: !!response && !response.outputLimitReached,
          };
        delete t.leaseId;
        delete t.leaseExpiresAt;
      }
    this.db.exec('BEGIN IMMEDIATE');
    const oldSignatures = this.journalSignatures;
    this.journalSignatures = new Map();
    try {
      this.db.exec('DELETE FROM project_journal');
      const journalChanges = this.saveJournals(restored);
      this.db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(this.payload(restored));
      for (const a of existing.values()) this.putAttempt(a);
      this.db.exec('DELETE FROM cache; DELETE FROM activity_events; DELETE FROM attempt_results');
      this.db.exec('DELETE FROM plan_versions');
      for (const version of parsed.planHistory || [])
        this.db
          .prepare('INSERT INTO plan_versions VALUES(?,?,?)')
          .run(version.projectId, version.revision, JSON.stringify(version));
      for (const r of parsed.attemptResults || [])
        this.db.prepare('INSERT OR REPLACE INTO attempt_results VALUES(?,?)').run(
          r.attemptId,
          JSON.stringify({
            text: r.text,
            outputLimitReached: r.outputLimitReached,
            observations: r.observations,
          }),
        );
      for (const a of [...(parsed.activityHistory || []), ...restored.activities].sort(
        (a, b) => a.createdAt - b.createdAt,
      ))
        this.recordActivity(a);
      restored.activities = this.activityHistory().slice(0, 250);
      this.db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(this.payload(restored));
      this.db.exec('COMMIT');
      this.state = restored;
      this.journalSignatures = journalChanges;
      this.pendingPlans.clear();
      this.revision++;
    } catch (error) {
      this.journalSignatures = oldSignatures;
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  save() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const journalChanges = this.saveJournals(this.state);
      for (const activity of [...this.state.activities].reverse()) this.recordActivity(activity);
      for (const version of this.pendingPlans.values())
        this.db
          .prepare('INSERT OR IGNORE INTO plan_versions VALUES(?,?,?)')
          .run(version.projectId, version.revision, JSON.stringify(version));
      this.state.activities = this.state.activities.slice(0, 250);
      this.db
        .prepare(
          'INSERT INTO workspace(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        )
        .run(this.payload(this.state));
      this.db.exec('COMMIT');
      this.revision++;
      this.pendingPlans.clear();
      for (const [key, payload] of journalChanges) this.journalSignatures.set(key, payload);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private recoverProjects(state: WorkspaceState) {
    for (const m of state.meetings || [])
      if (m.status === 'running' || m.status === 'gathering') {
        m.status = 'failed';
        m.error =
          'Meeting interrupted. Saved contributions are retained; review Usage before retrying.';
        delete m.speakerId;
      }
    for (const p of state.projects) {
      if (p.status === 'running') p.status = 'paused';
      if (p.planningStatus === 'planning') {
        p.planningStatus = 'failed';
        p.planningError =
          'Planning was interrupted. Your brief is saved. Review Usage before retrying.';
        p.status = 'paused';
      }
    }
  }
  close() {
    this.db.close();
  }
}
