import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Attempt, WorkspaceState } from '../shared/types.js';
import { defaultPolicy, backupSchema, stateSchema } from '../shared/schemas.js';
import { initialState } from './seed.js';

export class Store {
  private db: DatabaseSync;
  state: WorkspaceState;
  constructor(public path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, output TEXT NOT NULL)',
    );
    const row = this.db.prepare('SELECT payload FROM workspace WHERE id=1').get() as
      { payload: string } | undefined;
    this.state = row ? JSON.parse(row.payload) : initialState(process.env.WORKROOM_DEMO === '1');
    if (row && (this.state.schemaVersion || 1) < 4) this.snapshot('before-upgrade');
    this.state.schemaVersion = 4;
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
        const uncertain =
          task.attemptId &&
          this.attempts().some((a) => a.id === task.attemptId && a.status === 'uncertain');
        task.status =
          uncertain ||
          this.state.projects.find((p) => p.id === task.projectId)?.provider === 'external'
            ? 'failed'
            : 'queued';
        if (task.status === 'failed')
          task.error = 'Interrupted work may have consumed usage. Review Usage before retrying.';
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
  putAttempt(attempt: Attempt) {
    this.db
      .prepare(
        'INSERT INTO attempts(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(attempt.id, JSON.stringify(attempt));
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
    return {
      format: 'workroom' as const,
      version: 2 as const,
      createdAt: Date.now(),
      state: structuredClone(this.state),
      attempts: this.attempts(),
    };
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
    restored.schemaVersion = 4;
    restored.policy = { ...structuredClone(defaultPolicy), ...restored.policy, allowPaid: false };
    restored.memory ||= [];
    this.recoverProjects(restored);
    for (const t of restored.tasks)
      if (t.status === 'working') {
        t.status = 'failed';
        t.error = 'Restored in-flight work needs review before retry.';
        delete t.leaseId;
        delete t.leaseExpiresAt;
      }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify(restored));
      for (const a of existing.values()) this.putAttempt(a);
      this.db.exec('DELETE FROM cache; COMMIT');
      this.state = restored;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  save() {
    this.db
      .prepare(
        'INSERT INTO workspace(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(JSON.stringify(this.state));
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
