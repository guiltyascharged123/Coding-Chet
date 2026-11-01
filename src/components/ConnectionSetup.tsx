import { useEffect, useState, type FormEvent } from 'react';
import type { Bootstrap, Provider } from '../../shared/types';
import { DEFAULT_LOCAL_MODEL } from '../../shared/defaults';
import { api } from '../api';

type Settings = {
  revision: string;
  environmentOverrides: string[];
  codex: { model: string; enabled: boolean };
  openai: { model: string; hasKey: boolean };
  gemini: { model: string; hasKey: boolean };
  ollama: { model: string; url: string };
  compatible: { model: string; url: string; billing: 'local' | 'api'; hasKey: boolean };
};
type Login = { id: string; status: string; message: string; url?: string; code?: string };
export default function ConnectionSetup({
  provider,
  onRefresh,
  blocked,
  projectModel,
}: {
  provider: Exclude<Provider, 'demo' | 'external'>;
  onRefresh: (data: Bootstrap) => void;
  blocked: boolean;
  projectModel?: string;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [model, setModel] = useState(''),
    [url, setUrl] = useState('');
  const [key, setKey] = useState(''),
    [clearKey, setClearKey] = useState(false);
  const [enabled, setEnabled] = useState(false),
    [billing, setBilling] = useState<'local' | 'api'>('local');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [login, setLogin] = useState<Login | null>(null);
  const hasKey =
    settings && 'hasKey' in settings[provider]
      ? (settings[provider] as { hasKey: boolean }).hasKey
      : false;
  async function load() {
    try {
      const value = await api<Settings>('/connections/settings', undefined, 'GET');
      setSettings(value);
      setModel(value[provider].model || (provider === 'codex' ? projectModel || '' : ''));
      if (provider === 'ollama' || provider === 'compatible') setUrl(value[provider].url);
      setEnabled(value.codex.enabled);
      setBilling(value.compatible.billing);
      setKey('');
      setClearKey(false);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    if (provider === 'codex')
      void api<{ login: Login | null }>('/connections/codex/login', undefined, 'GET')
        .then((value) => setLogin(value.login))
        .catch(() => {});
  }, []);
  const waiting = login && ['starting', 'waiting'].includes(login.status);
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const value = await api<{ login: Login | null }>(
          '/connections/codex/login',
          undefined,
          'GET',
        );
        if (stopped) return;
        setLogin(value.login);
        if (value.login?.status === 'completed') {
          const data = await api<Bootstrap>('/connections/check');
          onRefresh(data);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [!!waiting]);
  async function save(enableCodex = enabled) {
    if (!settings) throw new Error('Load connection settings first.');
    const body = {
      provider,
      revision: settings.revision,
      model,
      ...(provider === 'codex' ? { enabled: enableCodex } : {}),
      ...(provider === 'ollama' || provider === 'compatible' ? { url } : {}),
      ...(['openai', 'gemini', 'compatible'].includes(provider)
        ? { ...(key ? { apiKey: key } : {}), clearKey }
        : {}),
      ...(provider === 'compatible' ? { billing } : {}),
    };
    const value = await api<{ settings: Settings; data: Bootstrap }>(
      '/connections/settings',
      body,
      'PUT',
    );
    setSettings(value.settings);
    setKey('');
    setClearKey(false);
    setEnabled(value.settings.codex.enabled);
    onRefresh(value.data);
    setMessage(
      'Saved to .env and applied to this server. Existing project models and spending permissions were retained.',
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await save();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="connection-setup" aria-label={`${provider} setup form`}>
      {!settings && !error && <p role="status">Loading saved settings…</p>}
      {settings && (
        <form onSubmit={submit}>
          <p>
            Saved keys stay on the Workroom computer. They are never sent back into this form.
            Passwords for your Google or ChatGPT account are not used here.
          </p>
          {provider === 'codex' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enable Codex on this computer
            </label>
          )}
          <label>
            Default model ID
            <input
              aria-label={`${provider} default model ID`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              maxLength={150}
              required={provider !== 'codex'}
            />
          </label>
          <p className="field-hint">
            This sets the provider default. Saved projects keep their own model; use Change this
            project's connection to update one.
          </p>
          {(provider === 'ollama' || provider === 'compatible') && (
            <label>
              Server URL
              <input
                aria-label={`${provider} server URL`}
                type="url"
                value={url}
                maxLength={2048}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </label>
          )}
          {['openai', 'gemini', 'compatible'].includes(provider) && (
            <>
              <label>
                {hasKey ? 'Replace API key (leave blank to keep it)' : 'API key'}
                <input
                  aria-label={`${provider} API key`}
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  maxLength={8192}
                />
              </label>
              <p className="field-hint">
                {hasKey
                  ? 'A saved key is configured.'
                  : provider === 'compatible'
                    ? 'Local model servers often do not require a key.'
                    : 'No saved key is configured.'}
              </p>
              {hasKey && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={clearKey}
                    onChange={(e) => setClearKey(e.target.checked)}
                  />
                  Remove this saved API key
                </label>
              )}
            </>
          )}
          {provider === 'compatible' && (
            <label>
              Billing mode
              <select
                value={billing}
                onChange={(e) => setBilling(e.target.value as 'local' | 'api')}
              >
                <option value="local">Local computer · no API billing</option>
                <option value="api">Remote service · API spending controls</option>
              </select>
            </label>
          )}
          {provider === 'openai' && (
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              Create an OpenAI API key ↗
            </a>
          )}
          {provider === 'gemini' && (
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Create a Gemini / Google AI Studio API key ↗
            </a>
          )}
          {settings.environmentOverrides.length > 0 && (
            <p className="field-hint">
              The running server differs from .env for: {settings.environmentOverrides.join(', ')}.
              Shell exports can override .env at the next start; remove conflicting exports if
              needed.
            </p>
          )}
          {blocked && (
            <p role="status">
              Pause running projects before saving credentials or starting sign-in.
            </p>
          )}
          <button className="button secondary small" disabled={busy || blocked || !!waiting}>
            Save connection
          </button>
          {provider === 'codex' && (
            <button
              className="button primary small"
              type="button"
              disabled={busy || blocked || !!waiting}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await save(true);
                  const value = await api<{ login: Login }>('/connections/codex/login');
                  setLogin(value.login);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {enabled ? 'Sign in with ChatGPT' : 'Enable Codex & sign in with ChatGPT'}
            </button>
          )}
        </form>
      )}
      {provider === 'codex' && login && (
        <div className="device-login" role="status">
          <p>{login.message}</p>
          {login.url && (
            <a href={login.url} target="_blank" rel="noopener noreferrer">
              Open official OpenAI sign-in ↗
            </a>
          )}
          {login.code && (
            <p>
              One-time code: <code>{login.code}</code>
            </p>
          )}
          {waiting && (
            <button
              type="button"
              className="text-button"
              onClick={async () => {
                const value = await api<{ login: Login }>('/connections/codex/login/cancel', {
                  id: login.id,
                });
                setLogin(value.login);
              }}
            >
              Cancel this sign-in
            </button>
          )}
        </div>
      )}
      {provider === 'ollama' && (
        <aside className="local-model-help" aria-label="Local model setup instructions">
          <strong>Install or connect a local model</strong>
          <ol>
            <li>
              Install Ollama for Ubuntu or Windows from{' '}
              <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                ollama.com/download ↗
              </a>
              , or run <code>npm run setup:local</code> in Coding-Chet after saving the model above.
            </li>
            <li>
              If Ollama is not running, start <code>ollama serve</code> in another terminal.
            </li>
            <li>
              Download your selected model in a terminal, then Check connections:
              <pre>
                ollama pull {/^[-A-Za-z0-9._:/@+]+$/.test(model) ? model : DEFAULT_LOCAL_MODEL}
              </pre>
            </li>
          </ol>
          <p>
            On a computer with about 16 GB RAM, start with one small model and one active task.
            Larger models need more memory; speed and quality depend on your hardware.
          </p>
          <p>
            Other small-model examples from the Ollama catalog (availability and licenses come from
            their publishers):
          </p>
          <ul>
            {['qwen3:4b', 'gemma3:4b', 'llama3.2:3b'].map((id) => (
              <li key={id}>
                <code>{id}</code>{' '}
                <button type="button" className="text-button" onClick={() => setModel(id)}>
                  Use this model ID
                </button>
              </li>
            ))}
          </ul>
          <p>Choosing an ID does not download weights or change an existing project's model.</p>
        </aside>
      )}
      {provider === 'compatible' && (
        <aside className="local-model-help" aria-label="Other local model server instructions">
          <strong>LM Studio or llama.cpp</strong>
          <p>
            In{' '}
            <a href="https://lmstudio.ai/" target="_blank" rel="noreferrer">
              LM Studio ↗
            </a>
            , download a model, load it, and start its local API server. Enter its exact model ID
            and server URL above, commonly <code>http://127.0.0.1:1234/v1</code>, with Local
            billing.
          </p>
          <p>
            For llama.cpp, install its server and obtain a compatible GGUF model, then run (replace
            the example path):
          </p>
          <pre>llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080</pre>
          <p>
            Use <code>http://127.0.0.1:8080/v1</code> and the ID returned by that server's{' '}
            <code>/v1/models</code> endpoint. Then save and Check connections. Local servers
            generate text in this adapter; coding tools require Codex.
          </p>
        </aside>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="text-button" disabled={busy} onClick={() => void load()}>
        Reload saved settings · discard unsaved connection inputs
      </button>
    </section>
  );
}
