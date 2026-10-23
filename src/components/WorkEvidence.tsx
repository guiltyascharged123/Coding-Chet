import type { Task } from '../../shared/types';

export default function WorkEvidence({ task }: { task: Task }) {
  return (
    <>
      {task.result && (
        <section className="control-section" aria-label="Work result and acceptance checks">
          <h3>
            {task.result.outcome === 'complete'
              ? task.status === 'failed'
                ? 'Previous reported result · latest attempt failed'
                : 'Reported result'
              : 'Progress and outstanding work'}
          </h3>
          <p>{task.result.summary}</p>
          <p className="field-hint">
            Acceptance checks below are reported by the model. Command receipts and independent
            review provide additional evidence.
          </p>
          <ul>
            {task.result.checks.map((c, i) => (
              <li key={i}>
                <strong>
                  {c.status.replace('_', ' ')} · {c.criterion}
                </strong>
                <p>{c.evidence}</p>
              </li>
            ))}
          </ul>
          {!!task.result.handoff.assumptions.length && (
            <details>
              <summary>Assumptions still to validate</summary>
              <ul>
                {task.result.handoff.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          <p>
            <strong>Next:</strong> {task.result.handoff.next}
          </p>
          {!!task.result.followUps.length && (
            <details open>
              <summary>Requested internal assignments</summary>
              <ul>
                {task.result.followUps.map((f, i) => (
                  <li key={i}>
                    <strong>{f.title}</strong> · {f.agentId}
                    <p>{f.description}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!task.result.improvements.length && (
            <details>
              <summary>Proposed instruction improvements</summary>
              <p>
                Review and apply proposals in Workspace controls → Team instructions. They have not
                changed the team’s instructions.
              </p>
              {task.result.improvements.map((v, i) => (
                <div key={i}>
                  <p>
                    <strong>{v.problem}</strong>
                  </p>
                  <p>{v.change}</p>
                  <p>Evidence: {v.evidence}</p>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
      {task.contextReport && (
        <details className="control-section">
          <summary>
            Context used · {task.contextReport.inputBytes.toLocaleString()} /{' '}
            {task.contextReport.limit.toLocaleString()} bytes
          </summary>
          <p>
            The brief and assignment remain intact. Supporting sources are selected to fit.
            Originals remain in saved outputs, decisions and memory; the model can request source
            passages in up to two additional requests.
          </p>
          <ul>
            {task.contextReport.sources.map((s, i) => (
              <li key={`${s.id}-${i}`}>
                {s.label} ·{' '}
                {s.includedCharacters === s.totalCharacters
                  ? 'full source'
                  : s.includedCharacters
                    ? 'excerpt'
                    : 'not included'}{' '}
                ({s.includedCharacters.toLocaleString()} / {s.totalCharacters.toLocaleString()}{' '}
                characters)
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
