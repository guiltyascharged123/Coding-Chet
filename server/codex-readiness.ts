export type CodexDiagnostic = {
  ready: boolean;
  code:
    'disabled' | 'cli_unavailable' | 'check_failed' | 'api_key' | 'signed_out' | 'authenticated';
  message: string;
};

export function codexReadiness(
  enabled: boolean,
  login: { output: string; available: boolean; timedOut?: boolean },
  defaultModel: string,
): CodexDiagnostic {
  if (!enabled)
    return {
      ready: false,
      code: 'disabled',
      message: 'Codex is disabled. Enable it below and save.',
    };
  if (!login.available)
    return {
      ready: false,
      code: 'cli_unavailable',
      message: 'The bundled Codex CLI could not start. Run npm ci, then restart Workroom.',
    };
  if (login.timedOut)
    return {
      ready: false,
      code: 'check_failed',
      message: 'The CLI status check timed out. Check status again or reset sign-in.',
    };
  if (/api[- ]key/i.test(login.output))
    return {
      ready: false,
      code: 'api_key',
      message: 'The CLI uses an API key. Sign in with ChatGPT below instead.',
    };
  if (!/logged in.*chatgpt/is.test(login.output))
    return {
      ready: false,
      code: 'signed_out',
      message: 'Not signed in with ChatGPT. Sign in below or use npx --no-install codex login.',
    };
  return {
    ready: true,
    code: 'authenticated',
    message: `ChatGPT sign-in verified by the Codex CLI.${defaultModel ? '' : ' No default model is configured.'}`,
  };
}
