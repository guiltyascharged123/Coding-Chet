import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { codexEnvironment } from './managed.js';

export type LoginState = {
  id: string;
  status: 'starting' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  url?: string;
  code?: string;
  message: string;
  expiresAt: number;
};
export function devicePrompt(output: string) {
  const clean = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const urls = clean.match(/https:\/\/[^\s<>"']+/g) || [];
  const url = urls.find((value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.hostname === 'auth.openai.com' &&
        parsed.pathname.startsWith('/codex/device') &&
        !parsed.search &&
        !parsed.hash
      );
    } catch {
      return false;
    }
  });
  const code = clean.match(/\b[A-Z0-9]{4,6}(?:-[A-Z0-9]{4,6}){1,2}\b/)?.[0];
  return url && code ? { url, code } : undefined;
}

export class CodexLogin {
  private current?: LoginState;
  private child?: ChildProcess;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private launch: () => ChildProcess = () => {
      const entry = process.env.WORKROOM_CODEX_BIN
        ? ''
        : createRequire(import.meta.resolve('@openai/codex-sdk')).resolve(
            '@openai/codex/bin/codex.js',
          );
      return spawn(
        process.env.WORKROOM_CODEX_BIN || process.execPath,
        [
          ...(process.env.WORKROOM_CODEX_BIN ? [] : [entry]),
          'login',
          '--device-auth',
          '-c',
          'forced_login_method="chatgpt"',
        ],
        {
          env: codexEnvironment(),
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true,
        },
      );
    },
    private onFinished: () => void = () => {},
  ) {}
  state() {
    return this.current ? { ...this.current } : null;
  }
  start() {
    if (this.current && ['starting', 'waiting'].includes(this.current.status)) return this.state()!;
    const state: LoginState = {
      id: randomUUID(),
      status: 'starting',
      message:
        'Starting the official Codex device sign-in. No password or API key is sent through Workroom.',
      expiresAt: Date.now() + 15 * 60_000,
    };
    this.current = state;
    let output = '';
    const fail = () => {
      if (state.status === 'cancelled') return;
      state.status = 'failed';
      delete state.code;
      delete state.url;
      state.message =
        'Official Codex device sign-in could not finish. In the Workroom terminal, run npx --no-install codex login, choose ChatGPT, then check connections. Your existing settings were retained.';
      clearTimeout(this.timer);
      this.onFinished();
    };
    try {
      const child = (this.child = this.launch());
      const collect = (data: Buffer) => {
        if (!['starting', 'waiting'].includes(state.status)) return;
        output = (output + data.toString()).slice(-16000);
        const prompt = devicePrompt(output);
        if (prompt)
          Object.assign(state, prompt, {
            status: 'waiting',
            message:
              'Open the official OpenAI sign-in page and enter this one-time code. Complete sign-in there.',
          });
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      child.once('error', fail);
      child.once('close', (code) => {
        clearTimeout(this.timer);
        if (state.status === 'cancelled' || state.status === 'failed') return;
        delete state.code;
        delete state.url;
        if (code === 0) {
          state.status = 'completed';
          state.message =
            'The official CLI finished sign-in. Check connections to verify the account on this computer.';
          this.onFinished();
        } else fail();
      });
      this.timer = setTimeout(() => {
        fail();
        child.kill();
      }, 15 * 60_000);
      this.timer.unref();
    } catch {
      fail();
    }
    return this.state()!;
  }
  cancel(id?: string) {
    if (
      !this.current ||
      (id && this.current.id !== id) ||
      !['starting', 'waiting'].includes(this.current.status)
    )
      return this.state();
    Object.assign(this.current, {
      status: 'cancelled',
      message: 'This sign-in attempt was cancelled. Existing CLI credentials were not removed.',
    });
    delete this.current.code;
    delete this.current.url;
    clearTimeout(this.timer);
    this.child?.kill();
    this.onFinished();
    return this.state();
  }
}
