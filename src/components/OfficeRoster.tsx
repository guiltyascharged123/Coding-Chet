import type { CSSProperties } from 'react';
import type { Agent } from '../../shared/types';
import type { OfficeWork } from '../office/work';

/** No canvas, animation loop or graphics dependencies. */
export default function OfficeRoster({
  agents,
  work,
  onAgentClick,
}: {
  agents: Agent[];
  work: Record<string, OfficeWork>;
  onAgentClick: (id: string) => void;
}) {
  return (
    <div className="office-fallback office-roster" aria-label="Lightweight team view">
      <div className="fallback-desks">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onAgentClick(agent.id)}
            style={{ '--agent-color': agent.color } as CSSProperties}
          >
            <span className="fallback-agent">
              <i />
              <i />
            </span>
            <span className="fallback-desk" />
            <strong>{agent.name}</strong>
            <small>{agent.role}</small>
            <small>{work[agent.id]?.label}</small>
          </button>
        ))}
      </div>
      <p>Select a specialist to inspect its work. Tasks continue in either view.</p>
    </div>
  );
}
