import { useEffect, useRef, useState } from 'react';
import { Copy, Download, TerminalSquare } from 'lucide-react';
import type { Agent, Project, Task } from '../../shared/types';
import type { ConsoleEntry } from '../../shared/console';
import { saveBlob } from '../api';

function readable(entry: ConsoleEntry, raw: boolean) {
  if (raw || entry.type !== 'response') return entry.text;
  try {
    const value = JSON.parse(entry.text);
    if (typeof value.deliverable === 'string')
      return `${value.summary || ''}\n\n${value.deliverable}\n\n${Array.isArray(value.checks) ? value.checks.map((c: { status: string; criterion: string; evidence: string }) => `[${c.status}] ${c.criterion}: ${c.evidence}`).join('\n') : ''}`.trim();
    return JSON.stringify(value, null, 2);
  } catch {
    return entry.text;
  }
}

export default function LiveConsole({
  project,
  team,
  tasks,
  focus = {},
  meetingActive = false,
}: {
  project: Project;
  team: Agent[];
  tasks: Task[];
  focus?: { agentId?: string; taskId?: string };
  meetingActive?: boolean;
}) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [agent, setAgent] = useState(focus.agentId || '');
  const [task, setTask] = useState(focus.taskId || '');
  const [phase, setPhase] = useState('');
  const [raw, setRaw] = useState(false);
  const [requests, setRequests] = useState(false);
  const [follow, setFollow] = useState(true);
  const [reconnect, setReconnect] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setConnected(false);
    const source = new EventSource(
      `/api/projects/${encodeURIComponent(project.id)}/console/events`,
    );
    const snapshot = (event: MessageEvent) => {
      try {
        setEntries(JSON.parse(event.data).entries);
      } catch {
        setMessage('The console snapshot could not be read. Reconnect to reload it.');
      }
    };
    const update = (event: MessageEvent) => {
      try {
        const value = JSON.parse(event.data) as { entry?: ConsoleEntry; removed: string[] };
        setEntries((prior) =>
          [
            ...prior.filter((e) => e.id !== value.entry?.id && !value.removed.includes(e.id)),
            ...(value.entry ? [value.entry] : []),
          ].sort((a, b) => a.sequence - b.sequence),
        );
      } catch {
        setMessage('A console update could not be read. Reconnect to reload history.');
      }
    };
    source.addEventListener('snapshot', snapshot);
    source.addEventListener('update', update);
    source.addEventListener('warning', (event) => {
      try {
        setMessage(JSON.parse(event.data).message);
      } catch {
        setMessage('Console history could not be saved.');
      }
    });
    source.onopen = () => {
      setConnected(true);
      setMessage('');
    };
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [project.id, reconnect]);
  const filtered = entries.filter(
    (e) =>
      (!agent || e.agentId === agent) &&
      (!task || e.taskId === task) &&
      (!phase || e.phase === phase) &&
      (requests || e.type !== 'request'),
  );
  useEffect(() => {
    if (follow && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [entries, follow, agent, task, phase, requests, raw]);
  const text = filtered
    .map(
      (e) =>
        `[${new Date(e.updatedAt).toISOString()}] ${e.agentName || (e.phase === 'plan' ? 'Planner' : 'Workroom')} · ${e.phase} · ${e.type} · ${e.provider}${e.model ? ` / ${e.model}` : ''}${e.taskTitle ? `\nTask: ${e.taskTitle}` : ''}${e.attemptId ? `\nAttempt: ${e.attemptId}` : ''}\n${readable(e, raw)}`,
    )
    .join('\n\n');
  const active =
    meetingActive ||
    tasks.some((t) => t.status === 'working') ||
    project.planningStatus === 'planning' ||
    project.status === 'running';
  return (
    <section className="live-console" aria-label="Project live console">
      <div className="console-intro">
        <TerminalSquare size={24} />
        <div>
          <h2>Live console</h2>
          <p>
            Public model replies and tool output as received. Private reasoning is not available;
            some replies arrive only at completion.
          </p>
        </div>
      </div>
      <div className="console-toolbar">
        <label>
          Agent
          <select
            aria-label="Console agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="">All agents & planner</option>
            {team.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Task
          <select aria-label="Console task" value={task} onChange={(e) => setTask(e.target.value)}>
            <option value="">All tasks & meetings</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phase
          <select
            aria-label="Console phase"
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
          >
            <option value="">All phases</option>
            <option value="plan">Planning</option>
            <option value="task">Tasks</option>
            <option value="meeting">Meetings</option>
          </select>
        </label>
        <button
          className="button secondary small"
          onClick={() => {
            setAgent('');
            setTask('');
            setPhase('');
          }}
        >
          Show all work
        </button>
      </div>
      <div className="console-options">
        <label>
          <input
            type="checkbox"
            checked={requests}
            onChange={(e) => setRequests(e.target.checked)}
          />
          Show instructions & context
        </label>
        <label>
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          Raw replies
        </label>
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow new output
        </label>
      </div>
      <div className="console-status" role="status">
        <span>
          {connected ? 'Console connected' : 'Console disconnected · reconnecting'} ·{' '}
          {active ? 'Project work active' : 'No project work running'} · {filtered.length} entries
        </span>
        <button className="button secondary small" onClick={() => setReconnect((n) => n + 1)}>
          Reconnect
        </button>
      </div>
      <div
        ref={viewport}
        className="console-viewport"
        role="region"
        aria-label="Live console output"
        tabIndex={0}
      >
        {!filtered.length && (
          <div className="console-empty">
            <p>
              {entries.length
                ? 'No entries match these filters. Show all work or include instructions and context.'
                : 'No console history yet. Run a real-model assignment to see its replies and tool events here.'}
            </p>
            <p>
              Older runs cannot be reconstructed. Demo is labeled; external workers expose
              assignment status and submitted results, not their internal terminal.
            </p>
          </div>
        )}
        {filtered.map((e) => (
          <article className={`console-entry console-${e.type}`} key={e.id}>
            <header>
              <strong>
                {e.agentName || (e.phase === 'plan' ? 'Planner' : 'Workroom')} · {e.type}
              </strong>
              <span>
                {new Date(e.updatedAt).toLocaleTimeString()} · {e.status || e.phase}
              </span>
            </header>
            <div className="console-entry-meta">
              {e.agentRole ? `${e.agentRole} · ` : ''}
              {e.phase} · {e.provider}
              {e.model ? ` / ${e.model}` : ''}
              {e.taskTitle ? ` · ${e.taskTitle}` : ''}
            </div>
            {e.attemptId && (
              <details className="console-receipt">
                <summary>Request receipt</summary>
                <span>{e.attemptId}</span>
              </details>
            )}
            <pre>{readable(e, raw)}</pre>
            {e.truncated && (
              <p className="console-clipped">
                Console excerpt; the full request/result was not shortened by this viewer.
              </p>
            )}
          </article>
        ))}
      </div>
      <div className="console-actions">
        <button
          className="button secondary"
          disabled={!filtered.length}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setMessage('Visible console text copied.');
            } catch {
              setMessage('Clipboard is unavailable. Use Download visible log instead.');
            }
          }}
        >
          <Copy size={16} />
          Copy visible log
        </button>
        <button
          className="button secondary"
          disabled={!filtered.length}
          onClick={() =>
            saveBlob(
              `${project.title.replace(/[^a-z0-9-]+/gi, '-').slice(0, 60)}-console.txt`,
              new Blob([text], { type: 'text/plain;charset=utf-8' }),
            )
          }
        >
          <Download size={16} />
          Download visible log
        </button>
      </div>
      {message && (
        <p className="field-hint" role="status">
          {message}
        </p>
      )}
      <p className="field-hint">
        Read-only viewer; no extra model requests. Recent history is bounded to 300 entries /
        480,000 characters per project and 1,000 entries / 2,000,000 characters across the
        workspace. Individual entries may be clipped. Known credentials are redacted, but project
        text and command output may still be sensitive. History stays in the local SQLite database;
        portable project backups do not include it. Download a log if you need a separate copy.
      </p>
    </section>
  );
}
