import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { streamApi } from '../api';
import { useSavedDraft } from '../drafts';

type Message = { role: 'user' | 'assistant'; content: string; interrupted?: boolean };
export default function LocalModelChat({
  model,
  models,
  onClose,
}: {
  model: string;
  models: string[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(model);
  const [saved, save, clear, storageError] = useSavedDraft<{ messages: Message[]; draft: string }>(
    `workroom-local-chat-${selected}`,
    { messages: [], draft: '' },
  );
  const messages = Array.isArray(saved.messages) ? saved.messages : [];
  const [busy, setBusy] = useState(false),
    [live, setLive] = useState(''),
    [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [live, messages.length]);
  async function send() {
    const text = saved.draft.trim();
    if (!text || busy) return;
    // An interrupted turn remains visible, but is not supplied as a completed
    // assistant answer on the next request. Never silently discard complete pairs.
    const history = messages.filter(
      (entry, index) =>
        !entry.interrupted &&
        (entry.role === 'assistant' ||
          (messages[index + 1]?.role === 'assistant' && !messages[index + 1].interrupted)),
    );
    const pending: Message[] = [...history, { role: 'user', content: text }];
    const displayed: Message[] = [...messages, { role: 'user', content: text }];
    const abort = new AbortController();
    controller.current = abort;
    let answer = '',
      completed = false;
    setBusy(true);
    setError('');
    setLive('');
    save({ messages: displayed, draft: '' });
    try {
      const response = await streamApi(
        '/local-chat',
        { model: selected, messages: pending.map(({ role, content }) => ({ role, content })) },
        abort.signal,
      );
      if (!response.body) throw new Error('The model returned no response stream.');
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += value || '';
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          if (done && buffer.trim()) {
            lines.push(buffer);
            buffer = '';
          }
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.error);
            if (event.type === 'text' || event.type === 'done') {
              answer = event.text || '';
              setLive(answer);
            }
            if (event.type === 'done') {
              completed = true;
              if (event.outputLimitReached)
                setError('Output limit reached. Ask for a shorter answer or continuation.');
            }
          }
          if (done) break;
        }
        if (!completed)
          throw new Error(
            'Connection ended before the completion receipt. Partial text is retained.',
          );
      } finally {
        reader.releaseLock();
      }
    } catch (failure) {
      const stopped = abort.signal.aborted;
      abort.abort();
      setError(
        stopped
          ? 'Reply stopped. Partial text is retained.'
          : failure instanceof Error
            ? failure.message
            : 'Request failed.',
      );
    } finally {
      save({
        messages: [
          ...displayed,
          { role: 'assistant', content: answer || 'No reply received.', interrupted: !completed },
        ],
        draft: completed ? '' : text,
      });
      setLive('');
      setBusy(false);
      controller.current = undefined;
    }
  }
  return (
    <main className="local-chat-page">
      <header className="section-header">
        <div>
          <h1>Local model chat</h1>
          <p>
            Talk directly to your Ollama model. History stays in this browser; this chat has no
            agent tools.
          </p>
        </div>
        <button className="button secondary" onClick={onClose}>
          Back to workspace
        </button>
      </header>
      <div className="local-chat-toolbar">
        <label>
          Exact model
          <select
            aria-label="Chat model"
            value={selected}
            disabled={busy}
            onChange={(event) => {
              setSelected(event.target.value);
              setError('');
            }}
          >
            {[...new Set([model, ...models])].map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            clear();
            setError('');
          }}
        >
          New chat
        </button>
      </div>
      <section className="local-chat-history" aria-label="Chat messages" aria-live="polite">
        {!messages.length && !busy && (
          <p className="field-hint">
            Send a question, a problem, or ask it to challenge an idea. Replies will stream here.
          </p>
        )}
        {messages.map((entry, index) => (
          <article key={index} className={`local-chat-message ${entry.role}`}>
            <strong>
              {entry.role === 'user' ? 'You' : selected}
              {entry.interrupted ? ' · interrupted' : ''}
            </strong>
            <ReactMarkdown>{entry.content}</ReactMarkdown>
          </article>
        ))}
        {busy && (
          <article className="local-chat-message assistant">
            <strong>{selected} · replying</strong>
            {live ? (
              <ReactMarkdown>{live}</ReactMarkdown>
            ) : (
              <p>Loading or processing your message…</p>
            )}
          </article>
        )}
        <div ref={bottom} />
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="local-chat-composer"
      >
        <label htmlFor="local-chat-input">Message</label>
        <textarea
          id="local-chat-input"
          rows={4}
          maxLength={12000}
          value={saved.draft || ''}
          disabled={busy}
          placeholder="Ask the model…"
          onChange={(event) => save({ messages, draft: event.target.value })}
        />
        <div>
          {busy ? (
            <button
              key="stop"
              type="button"
              className="button secondary"
              onClick={(event) => {
                event.preventDefault();
                controller.current?.abort();
              }}
            >
              Stop reply
            </button>
          ) : (
            <button
              key="send"
              type="submit"
              className="button primary"
              disabled={!saved.draft?.trim()}
            >
              Send message
            </button>
          )}
        </div>
      </form>
      {(error || storageError) && <p role="alert">{error || storageError}</p>}
    </main>
  );
}
