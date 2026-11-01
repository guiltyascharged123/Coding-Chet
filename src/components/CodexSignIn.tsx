import { useEffect, useRef, useState } from 'react';
import type { Bootstrap } from '../../shared/types';
import type { CodexConnectionState, CodexLoginMode } from '../../shared/codex-connection';
import { api } from '../api';

type Snapshot = CodexConnectionState & { data: Bootstrap };
const pending = (value: CodexConnectionState | undefined) =>
  !!value?.login && ['starting', 'waiting', 'stopping'].includes(value.login.status);
export default function CodexSignIn({
  blocked,
  ensureEnabled,
  reloadSettings,
  onRefresh,
}: {
  blocked: boolean;
  ensureEnabled: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  onRefresh: (data: Bootstrap) => void;
}) {
  const [connection, setConnection] = useState<Snapshot>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const revision = useRef(-1);
  function receive(value: Snapshot) {
    onRefresh(value.data);
    if (value.revision < revision.current) return;
    revision.current = value.revision;
    setConnection(value);
  }
  useEffect(() => {
    let disposed = false;
    void api<Snapshot>('/connections/codex/login', undefined, 'GET')
      .then((value) => {
        if (!disposed) receive(value);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const active = pending(connection);
  useEffect(() => {
    if (!active) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api<Snapshot>('/connections/codex/login', undefined, 'GET');
        if (disposed) return;
        receive(value);
        if (pending(value)) timer = setTimeout(poll, 1500);
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          timer = setTimeout(poll, 3000);
        }
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [active]);
  async function act(action: 'connect' | 'check' | 'reset', mode: CodexLoginMode = 'browser') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'connect') {
        // Reset first so saving an enabled connection cannot deadlock behind its own old login.
        receive(await api<Snapshot>('/connections/codex/login/reset'));
        await ensureEnabled();
        receive(await api<Snapshot>('/connections/codex/login', { mode, reconnect: true }));
      } else {
        receive(await api<Snapshot>(`/connections/codex/login/${action}`));
        if (action === 'reset') {
          await reloadSettings();
          setNotice('Attempt cleared. Saved sign-in was kept.');
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const proof = connection?.proof;
  const result =
    proof?.code === 'authenticated'
      ? 'Signed in with ChatGPT'
      : proof?.code === 'signed_out'
        ? 'Not signed in'
        : proof?.message;
  return (
    <section className="codex-sign-in" aria-label="ChatGPT sign-in">
      <div className="provider-actions">
        <button
          type="button"
          className="button primary small"
          disabled={busy || (blocked && !active)}
          onClick={() => void act('connect')}
        >
          {proof?.code === 'authenticated' || active ? 'Reconnect ChatGPT' : 'Sign in with ChatGPT'}
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => void act('check')}
        >
          Check status
        </button>
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={() => void act('reset')}
        >
          Reset sign-in
        </button>
      </div>
      {busy && <p role="status">Checking connection…</p>}
      {connection?.login && <p role="status">{connection.login.message}</p>}
      {connection?.login?.url && (
        <a href={connection.login.url} target="_blank" rel="noopener noreferrer">
          Open ChatGPT sign-in ↗
        </a>
      )}
      {connection?.login?.code && (
        <p>
          One-time code: <code>{connection.login.code}</code>
        </p>
      )}
      <pre className="codex-status-terminal" aria-label="Codex CLI status">
        {proof
          ? `$ ${proof.command}\n${result}\nExit: ${proof.exitCode ?? 'not available'} · Checked ${new Date(proof.checkedAt).toLocaleTimeString()}`
          : 'Checking the Codex CLI sign-in…'}
      </pre>
      <details>
        <summary>Terminal or remote sign-in</summary>
        <p>In Coding-Chet, run this command, then Check status here:</p>
        <pre>npx --no-install codex login</pre>
        <p>
          For a remote computer, device sign-in may require enabling it in your ChatGPT account.
        </p>
        <button
          type="button"
          className="text-button"
          disabled={busy || (blocked && !active)}
          onClick={() => void act('connect', 'device')}
        >
          Use device code instead
        </button>
      </details>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
