import { useEffect, useState } from 'react';
import type { Bootstrap } from '../../shared/types';
import type { ConsoleEntry } from '../../shared/console';
import { modelJobs, type ModelJob } from '../model-work';
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export default function ModelActivity({
  data,
  projectId,
  entries,
  connected,
  onConsole,
  onPause,
  onLimits,
  busy,
}: {
  data: Bootstrap;
  projectId: string;
  entries: ConsoleEntry[];
  connected: boolean;
  onConsole: (job: ModelJob) => void;
  onPause: () => void;
  onLimits: () => void;
  busy: boolean;
}) {
  const jobs = modelJobs(data, projectId, entries),
    active = jobs.some((job) => job.active);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, projectId]);
  if (!jobs.length) return null;
  const content = (
    <>
      <div className="section-header">
        <h2>Model activity</h2>
        <span>{active ? 'Work in progress' : 'No model request running'}</span>
      </div>
      {!connected && (
        <p className="field-hint" role="status">
          Live output is disconnected or reconnecting. The last saved event may be out of date.
        </p>
      )}
      {jobs.map((job) => {
        const requestElapsed = job.requestAt
          ? Math.max(
              0,
              Math.floor(((job.active ? now : job.lastUpdate || now) - job.requestAt) / 1000),
            )
          : undefined;
        const timeout =
          job.metrics?.timeoutSeconds ||
          data.state.projects.find((project) => project.id === projectId)?.requestTimeoutSeconds ||
          900;
        return (
          <article key={job.id} data-phase={job.phase} data-active={job.active}>
            <div className="model-job-heading">
              <div>
                <strong>
                  {job.actor} · {job.role}
                </strong>
                <p>{job.assignment}</p>
              </div>
              <b role="status">{job.label}</b>
            </div>
            <small>
              {job.provider} / {job.model || 'worker-managed model'} · {job.phase}
              {job.purpose !== 'initial'
                ? ` · ${job.purpose === 'correction' ? 'format correction' : 'source retrieval'}`
                : ''}
            </small>
            <dl>
              {requestElapsed !== undefined && (
                <div>
                  <dt>{job.provider === 'external' ? 'Assignment elapsed' : 'Request elapsed'}</dt>
                  <dd>
                    {clock(requestElapsed)}
                    {job.provider === 'external'
                      ? ' · model timing is worker-managed'
                      : ` · timeout ${clock(timeout)}`}
                  </dd>
                </div>
              )}
              {job.metrics?.inputBytes !== undefined && (
                <div>
                  <dt>Input</dt>
                  <dd>
                    {job.metrics.inputBytes.toLocaleString()} /{' '}
                    {job.metrics.contextLimitBytes?.toLocaleString() || 'configured'} bytes ·{' '}
                    {job.metrics.sourceCount || 0} saved sources selected
                  </dd>
                </div>
              )}
              {job.characters !== undefined && (
                <div>
                  <dt>Public reply received</dt>
                  <dd>{job.characters.toLocaleString()} characters</dd>
                </div>
              )}
              {job.inputTokens !== undefined && (
                <div>
                  <dt>Confirmed receipt</dt>
                  <dd>
                    {job.inputTokens.toLocaleString()} input /{' '}
                    {job.outputTokens?.toLocaleString() || 'unknown'} output tokens
                  </dd>
                </div>
              )}
              {job.active && job.lastUpdate && (
                <div>
                  <dt>Last public event</dt>
                  <dd>{clock(Math.max(0, Math.floor((now - job.lastUpdate) / 1000)))} ago</dd>
                </div>
              )}
            </dl>
            <div className="file-actions">
              <button className="button secondary small" onClick={() => onConsole(job)}>
                Open live console
              </button>
              <details className="model-request-details">
                <summary>Request details</summary>
                <p>{job.detail}</p>
              </details>
            </div>
          </article>
        );
      })}
      <div className="file-actions">
        {active && (
          <button className="button secondary small" disabled={busy} onClick={onPause}>
            Pause project work
          </button>
        )}
        <button className="text-button" onClick={onLimits}>
          View limits and timeouts
        </button>
      </div>
    </>
  );
  return (
    <section
      className={`model-activity ${active ? 'active' : 'compact'}`}
      aria-label="Model activity"
    >
      {active ? (
        content
      ) : (
        <details>
          <summary>No model request running · {jobs[0].label}</summary>
          {content}
        </details>
      )}
    </section>
  );
}
