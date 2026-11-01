import { ArrowRight, TerminalSquare } from 'lucide-react';
import type { Agent, Task } from '../../shared/types';
import type { OfficeWork as Work } from '../office/work';

export default function OfficeWork({
  agents,
  work,
  connected,
  message,
  onTask,
  onConsole,
}: {
  agents: Agent[];
  work: Record<string, Work>;
  connected: boolean;
  message: string;
  onTask: (task: Task) => void;
  onConsole: (agentId?: string) => void;
}) {
  return (
    <section className="office-work" aria-label="Team at work">
      {!connected && (
        <p className="field-hint" role="status">
          Live output disconnected · reconnecting. Showing saved task states.
        </p>
      )}
      {message && (
        <p className="field-hint" role="status">
          {message}
        </p>
      )}
      <div className="office-work-grid">
        {agents.map((agent) => {
          const current = work[agent.id];
          return (
            <article
              key={agent.id}
              className={`office-work-agent ${current.active ? 'active' : ''}`}
              data-agent-id={agent.id}
            >
              <div className="office-work-heading">
                <i style={{ background: agent.color }} />
                <strong>{agent.name}</strong>
                <span>{agent.role}</span>
              </div>
              <b>{current.label}</b>
              {current.task ? (
                <button className="office-work-task" onClick={() => onTask(current.task!)}>
                  {current.task.title}
                  <ArrowRight size={14} />
                </button>
              ) : (
                <p>{current.detail}</p>
              )}
              {current.entry && (
                <p className="office-work-detail" title={current.detail}>
                  {current.detail}
                </p>
              )}
              <button className="office-work-console" onClick={() => onConsole(agent.id)}>
                <TerminalSquare size={15} />
                Live output
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
