import { useState } from 'react';

function read<T>(key: string, initial: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value !== null && typeof value === typeof initial) return value;
  } catch {
    /* The hook exposes persistence failures. */
  }
  return initial;
}
// Write on the input event, before a dialog can unmount or navigation can occur.
export function useSavedDraft<T>(key: string, initial: T) {
  const [stored, setStored] = useState(() => ({ key, value: read(key, initial) }));
  const [error, setError] = useState('');
  const value = stored.key === key ? stored.value : read(key, initial);
  function update(next: T) {
    setStored({ key, value: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setError('');
    } catch {
      setError('Browser storage is unavailable. Keep a copy before closing.');
    }
  }
  function clear() {
    setStored({ key, value: initial });
    try {
      localStorage.removeItem(key);
    } catch {
      /* A successful server save is authoritative. */
    }
  }
  return [value, update, clear, error] as const;
}
