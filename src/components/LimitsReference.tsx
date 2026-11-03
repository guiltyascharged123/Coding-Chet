import { useEffect, useState } from 'react';
import { api } from '../api';
import type { limitsCatalog } from '../../server/limits-catalog';
type Reference = ReturnType<typeof limitsCatalog>;
export default function LimitsReference({
  projectId,
  onEdit,
}: {
  projectId?: string;
  onEdit: () => void;
}) {
  const [reference, setReference] = useState<Reference>(),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setBusy(true);
    api<Reference>(
      `/limits${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
      undefined,
      'GET',
    )
      .then((value) => {
        if (current) setReference(value);
      })
      .catch((error) => {
        if (current) setError(error.message);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [projectId]);
  const matches = (value: unknown) =>
    JSON.stringify(value).toLowerCase().includes(query.trim().toLowerCase());
  const formats = reference?.formats.filter(matches) || [];
  return (
    <section className="limits-reference">
      <h3>Limits reference</h3>
      <p>
        Operational settings are editable. Fixed field and resource constraints show what they
        protect and how to proceed. Saved history and model context are separate.
      </p>
      <button className="button secondary small" onClick={onEdit}>
        Edit economy limits
      </button>
      <label>
        Search limits
        <input
          aria-label="Search limits"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title, context, timeout, files, history…"
        />
      </label>
      {busy && <p role="status">Reading current limits…</p>}
      {error && <p role="alert">{error}</p>}
      {reference && (
        <>
          <h4>Adjustable economy limits</h4>
          {reference.editable.filter(matches).map((limit) => (
            <article key={limit.key}>
              <strong>
                {limit.name}: {String(limit.value)}
              </strong>
              <p>
                Allowed range: {limit.min}–{limit.max}. {limit.why}
              </p>
              <small>{limit.edit}</small>
            </article>
          ))}
          <h4>Selected project</h4>
          {reference.project.filter(matches).map((limit) => (
            <article key={limit.name}>
              <strong>
                {limit.name}: {limit.value}
              </strong>
              <p>{limit.why}</p>
              <small>{limit.edit}</small>
            </article>
          ))}
          <h4>Fixed safeguards and retention</h4>
          {reference.fixed.filter(matches).map((limit) => (
            <article key={limit.name}>
              <strong>
                {limit.name}: {limit.value}
              </strong>
              <p>{limit.why}</p>
            </article>
          ))}
          <p>{reference.formatNotice}</p>
          <details key={query ? 'searching' : 'closed'} open={!!query}>
            <summary>Field and response constraints · {formats.length} matching rules</summary>
            {!formats.length && <p>No matching field constraints.</p>}
            {formats.map((limit, index) => (
              <article key={`${limit.group}:${limit.field}:${index}`}>
                <strong>
                  {limit.group} · {limit.field}
                </strong>
                <p>{limit.rule}</p>
                <small>{limit.why}</small>
              </article>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
