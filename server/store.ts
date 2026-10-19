import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkspaceState } from '../shared/types.js';
import { initialState } from './seed.js';

export class Store {
  private db: DatabaseSync;
  state: WorkspaceState;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
    );
    const row = this.db.prepare('SELECT payload FROM workspace WHERE id=1').get() as
      { payload: string } | undefined;
    this.state = row ? JSON.parse(row.payload) : initialState();
    // A process cannot retain in-flight model requests across a restart.
    for (const task of this.state.tasks)
      if (task.status === 'working') {
        task.status = 'queued';
        delete task.leaseId;
        delete task.leaseExpiresAt;
      }
    for (const project of this.state.projects)
      if (project.status === 'running') project.status = 'paused';
    this.save();
  }
  save() {
    this.db
      .prepare(
        'INSERT INTO workspace(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(JSON.stringify(this.state));
  }
  close() {
    this.db.close();
  }
}
