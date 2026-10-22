import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import { api, saveBlob } from '../api';

export default function ProjectFiles({
  project,
  revision,
}: {
  project: Project;
  revision: string;
}) {
  const [data, setData] = useState<{ folder: string; files: { path: string; bytes: number }[] }>();
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const previewRequest = useRef(0);
  useEffect(() => {
    let active = true;
    api<NonNullable<typeof data>>(`/projects/${project.id}/files`, undefined, 'GET')
      .then((d) => {
        if (active) {
          setData(d);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [project.id, revision, refresh]);
  async function open(path: string) {
    const request = ++previewRequest.current;
    setSelected(path);
    setContent('Loading…');
    try {
      const response = await fetch(
        `/api/projects/${project.id}/file?path=${encodeURIComponent(path)}`,
      );
      if (!response.ok)
        throw new Error('This file cannot be previewed. Use the local project folder.');
      const text = await response.text();
      if (request !== previewRequest.current) return;
      setContent(
        text.includes('\0') ? 'Binary file. Use the source download or local folder.' : text,
      );
    } catch (e) {
      if (request !== previewRequest.current) return;
      setContent((e as Error).message);
    }
  }
  async function exportSource() {
    try {
      const response = await fetch(`/api/projects/${project.id}/source.zip`);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Source download failed.');
      }
      saveBlob(`${project.workspaceFolder || 'project'}-source.zip`, await response.blob());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="project-files">
      <div className="section-header">
        <h3>Project files</h3>
        <div className="file-actions">
          <button className="button secondary small" onClick={() => setRefresh((n) => n + 1)}>
            Refresh files
          </button>
          <button className="button secondary small" onClick={exportSource}>
            Download source ZIP
          </button>
        </div>
      </div>
      <p>
        Local folder: <code>{data?.folder || project.workspaceFolder}</code>
      </p>
      <p className="field-hint">
        Files persist on this computer. Source downloads omit hidden files, credentials and
        dependency folders. The JSON workspace backup contains task records, not source files; back
        up this folder separately.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {data?.files.length ? (
        <div className="file-browser">
          <div className="file-list">
            {data.files.map((f) => (
              <button
                className={selected === f.path ? 'selected' : ''}
                key={f.path}
                onClick={() => open(f.path)}
              >
                {f.path}
                <small>{f.bytes.toLocaleString()} B</small>
              </button>
            ))}
          </div>
          <div className="file-preview">
            <strong>{selected || 'Select a file'}</strong>
            <pre>{content}</pre>
          </div>
        </div>
      ) : (
        <p>No source files yet. The team creates them when implementation starts.</p>
      )}
    </section>
  );
}
