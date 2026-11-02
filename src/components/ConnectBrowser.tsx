import { useState } from 'react';
import { getState, setBrowserKey } from '../api';
import BrandMark from './BrandMark';

export default function ConnectBrowser() {
  const [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="loading-screen">
      <BrandMark />
      <h1>Connect this browser</h1>
      <p>
        Open the private Workroom link printed in your server terminal, or paste its connection code
        below.
      </p>
      <form
        className="modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const value = key.includes('#workroom-key=')
              ? new URLSearchParams(key.split('#')[1]).get('workroom-key') || ''
              : key;
            setBrowserKey(value);
            await getState();
            location.reload();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          Connection code
          <input
            aria-label="Browser connection code"
            type="password"
            autoComplete="off"
            value={key}
            required
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="button primary" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect browser'}
        </button>
      </form>
    </main>
  );
}
