import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkCodexSignIn, codexEnvironment } from './managed.js';
import type {
  CodexAuthProof,
  CodexConnectionState,
  CodexLoginMode,
  CodexLoginState,
} from '../shared/codex-connection.js';

export function devicePrompt(output: string) {
  const clean = output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const url = (clean.match(/https:\/\/[^\s<>"']+/g) || []).find((value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.hostname === 'auth.openai.com' &&
        /^\/codex\/device\/?$/.test(parsed.pathname) &&
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
export function browserPrompt(output: string) {
  return (output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').match(/https:\/\/[^\s<>"']+/g) || []).find(
    (value) => {
      try {
        const url = new URL(value),
          callback = new URL(url.searchParams.get('redirect_uri') || '');
        return (
          url.hostname === 'auth.openai.com' &&
          url.pathname === '/oauth/authorize' &&
          !url.username &&
          !url.password &&
          callback.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname) &&
          callback.pathname === '/auth/callback' &&
          !callback.username &&
          !callback.password
        );
      } catch {
        return false;
      }
    },
  );
}
export function codexLoginCommand(mode: CodexLoginMode) {
  const entry = process.env.WORKROOM_CODEX_BIN
    ? undefined
    : createRequire(import.meta.resolve('@openai/codex-sdk')).resolve('@openai/codex/bin/codex.js');
  return {
    command: process.env.WORKROOM_CODEX_BIN || process.execPath,
    args: [
      ...(entry ? [entry] : []),
      'login',
      ...(mode === 'device' ? ['--device-auth'] : []),
      '-c',
      'forced_login_method="chatgpt"',
    ],
  };
}
function credentialStamp() {
  // Observe replacement by a terminal login without reading credentials or exposing paths.
  try {
    const s = statSync(
      join(process.env.HOME || process.env.USERPROFILE || homedir(), '.codex', 'auth.json'),
    );
    return `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  } catch {
    return '';
  }
}
type Attempt = {
  state: CodexLoginState;
  owner: string;
  baselineAuthenticated: boolean;
  stamp: string;
  child?: ChildProcess;
  closed: boolean;
  closedPromise: Promise<void>;
  close: () => void;
  settled: boolean;
  stopping?: { status: 'completed' | 'failed' | 'cancelled'; message: string };
  timer?: ReturnType<typeof setTimeout>;
};
type Options = {
  launch?: (mode: CodexLoginMode) => ChildProcess;
  check?: () => Promise<CodexAuthProof>;
  stamp?: () => string;
  acquire?: () => string;
  release?: (owner: string) => void;
  changed?: () => void;
  timeoutMs?: number;
};

export class CodexLogin {
  private revision = 0;
  private current?: Attempt;
  private stopped = false;
  private proof: CodexAuthProof | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private options: Options = {}) {}
  state(): CodexConnectionState {
    return {
      revision: this.revision,
      login: this.current ? { ...this.current.state } : null,
      proof: this.proof ? { ...this.proof } : null,
    };
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  private async inspect() {
    try {
      this.proof = await (this.options.check || checkCodexSignIn)();
    } catch {
      this.proof = {
        command: 'npx --no-install codex login status',
        checkedAt: Date.now(),
        code: 'check_failed',
        message: 'The CLI login status could not be checked.',
        exitCode: null,
      };
    }
    this.notify();
    return this.proof;
  }
  private notify() {
    this.revision++;
    this.options.changed?.();
  }
  private finish(attempt: Attempt, status: 'completed' | 'failed' | 'cancelled', message: string) {
    if (attempt.settled) return;
    attempt.settled = true;
    clearTimeout(attempt.timer);
    Object.assign(attempt.state, { status, message });
    delete attempt.state.url;
    delete attempt.state.code;
    this.options.release?.(attempt.owner);
    this.notify();
  }
  private async waitClosed(attempt: Attempt, milliseconds: number) {
    if (attempt.closed) return true;
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), milliseconds);
      timeout.unref();
      void attempt.closedPromise.then(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }
  private async stop(
    attempt: Attempt,
    status: 'completed' | 'failed' | 'cancelled',
    message: string,
  ) {
    clearTimeout(attempt.timer);
    if (attempt.closed || !attempt.child) {
      this.finish(attempt, status, message);
      return;
    }
    attempt.stopping = { status, message };
    attempt.state.status = 'stopping';
    attempt.state.message = 'Stopping the previous sign-in process…';
    delete attempt.state.url;
    delete attempt.state.code;
    this.notify();
    attempt.child.kill('SIGTERM');
    if (!(await this.waitClosed(attempt, 1200))) {
      attempt.child.kill('SIGKILL');
      await this.waitClosed(attempt, 2500);
    }
    if (!attempt.closed)
      throw new Error('The sign-in process could not stop. Restart Workroom before reconnecting.');
    this.finish(attempt, status, message);
  }
  start(mode: CodexLoginMode = 'browser', reconnect = false) {
    return this.exclusive(async () => {
      if (this.stopped) throw new Error('Workroom is stopping.');
      if (this.current && !this.current.settled) {
        if (!reconnect) return this.state();
        await this.stop(this.current, 'cancelled', 'Previous attempt stopped.');
      }
      const owner = this.options.acquire?.() || randomUUID();
      let close!: () => void;
      const attempt: Attempt = {
        owner,
        state: {
          id: randomUUID(),
          mode,
          status: 'starting',
          message: 'Starting Codex sign-in…',
          expiresAt: Date.now() + (this.options.timeoutMs ?? 15 * 60_000),
        },
        baselineAuthenticated: false,
        stamp: '',
        closed: false,
        closedPromise: new Promise<void>((resolve) => {
          close = resolve;
        }),
        close: () => close(),
        settled: false,
      };
      this.current = attempt;
      try {
        const baseline = await this.inspect();
        if (this.stopped) {
          this.finish(attempt, 'cancelled', 'Workroom stopped.');
          return this.state();
        }
        attempt.baselineAuthenticated = baseline.code === 'authenticated';
        attempt.stamp = (this.options.stamp || credentialStamp)();
        const child = (attempt.child = this.options.launch
          ? this.options.launch(mode)
          : (() => {
              const spec = codexLoginCommand(mode);
              return spawn(spec.command, spec.args, {
                env: codexEnvironment(),
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
                windowsHide: true,
              });
            })());
        let output = '';
        const collect = (data: Buffer) => {
          if (attempt !== this.current || attempt.settled || attempt.stopping) return;
          output = (output + data.toString()).slice(-16000);
          if (
            mode === 'device' &&
            /enable device.code sign.in|device.{0,40}(?:disabled|not enabled)/i.test(output)
          ) {
            void this.exclusive(async () => {
              if (!attempt.settled)
                await this.stop(
                  attempt,
                  'failed',
                  'Device sign-in is disabled for this account. Use browser sign-in or npx --no-install codex login.',
                );
            }).catch(() => {});
            return;
          }
          const prompt = mode === 'device' ? devicePrompt(output) : undefined;
          const url = mode === 'browser' ? browserPrompt(output) : prompt?.url;
          if (url) {
            Object.assign(attempt.state, {
              status: 'waiting',
              url,
              code: prompt?.code,
              message:
                mode === 'browser'
                  ? 'Finish sign-in in your browser.'
                  : 'Enter the one-time code on OpenAI’s page.',
            });
            this.notify();
          }
        };
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        child.on('error', () => {
          if (!child.pid)
            this.finish(
              attempt,
              'failed',
              'The bundled Codex CLI could not start. Check its installation or use the terminal command below.',
            );
          else {
            attempt.state.message =
              'The sign-in process reported an error. Reset sign-in before retrying.';
            this.notify();
          }
        });
        child.once('close', (code) => {
          attempt.closed = true;
          attempt.close();
          clearTimeout(attempt.timer);
          if (attempt.stopping) {
            this.finish(attempt, attempt.stopping.status, attempt.stopping.message);
            return;
          }
          void this.exclusive(async () => {
            if (attempt !== this.current || attempt.settled) return;
            try {
              const proof = await this.inspect();
              this.finish(
                attempt,
                proof.code === 'authenticated' ? 'completed' : 'failed',
                proof.code === 'authenticated'
                  ? 'ChatGPT sign-in verified.'
                  : code === 0
                    ? proof.message
                    : 'Sign-in did not finish. Reconnect or use the terminal command below.',
              );
            } catch {
              this.finish(
                attempt,
                'failed',
                'Could not verify the CLI sign-in. Check status or reset this attempt.',
              );
            }
          });
        });
        attempt.timer = setTimeout(
          () => {
            void this.exclusive(async () => {
              if (!attempt.settled)
                await this.stop(attempt, 'failed', 'Sign-in timed out. Reconnect to try again.');
            }).catch(() => {});
          },
          this.options.timeoutMs ?? 15 * 60_000,
        );
        attempt.timer.unref();
        this.notify();
      } catch {
        this.finish(
          attempt,
          'failed',
          'Could not start Codex sign-in. Use npx --no-install codex login, then Check status.',
        );
      }
      return this.state();
    });
  }
  check(acceptExisting = false) {
    return this.exclusive(async () => {
      const proof = await this.inspect(),
        attempt = this.current;
      if (
        attempt &&
        !attempt.settled &&
        proof.code === 'authenticated' &&
        (acceptExisting ||
          !attempt.baselineAuthenticated ||
          attempt.stamp !== (this.options.stamp || credentialStamp)())
      ) {
        await this.stop(
          attempt,
          'completed',
          'ChatGPT sign-in verified. The previous attempt was cleared.',
        );
      }
      if (acceptExisting && proof.code === 'authenticated' && attempt?.settled)
        this.current = undefined;
      this.notify();
      return this.state();
    });
  }
  reset(id?: string) {
    return this.exclusive(async () => {
      const attempt = this.current;
      if (id && attempt?.state.id !== id)
        throw new Error('This sign-in attempt was replaced. Refresh its status before resetting.');
      if (attempt && !attempt.settled)
        await this.stop(attempt, 'cancelled', 'Sign-in attempt cleared.');
      this.current = undefined;
      await this.inspect();
      this.notify();
      return this.state();
    });
  }
  shutdown() {
    this.stopped = true;
    const attempt = this.current;
    if (attempt && !attempt.settled && attempt.child && !attempt.closed) {
      clearTimeout(attempt.timer);
      attempt.stopping = { status: 'cancelled', message: 'Workroom stopped.' };
      attempt.child.kill('SIGTERM');
      const force = setTimeout(() => {
        if (!attempt.closed) attempt.child?.kill('SIGKILL');
      }, 500);
      force.unref();
      void attempt.closedPromise.then(() => clearTimeout(force));
    }
    return this.exclusive(async () => {
      if (this.current && !this.current.settled)
        await this.stop(this.current, 'cancelled', 'Workroom stopped.');
    });
  }
}
