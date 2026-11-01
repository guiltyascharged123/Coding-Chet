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
      message:
        'Codex is disabled in this running Workroom server: WORKROOM_CODEX_ENABLED is not 1. Your saved project and model are retained. On the Connections page, open Set up / sign in, check Enable Codex on this computer, and Save connection. If you edit .env manually instead, set WORKROOM_CODEX_ENABLED=1 and restart Workroom. The official Codex CLI is already bundled; no separate installation is normally needed.',
    };
  if (!login.available)
    return {
      ready: false,
      code: 'cli_unavailable',
      message:
        'The bundled Codex CLI could not start. Run npm ci in Coding-Chet, then restart Workroom. If WORKROOM_CODEX_BIN is set, check that executable path.',
    };
  if (login.timedOut)
    return {
      ready: false,
      code: 'check_failed',
      message:
        'The local Codex sign-in check timed out. On the Ubuntu computer running Workroom, run npx --no-install codex login status, then check connections again.',
    };
  if (/api[- ]key/i.test(login.output))
    return {
      ready: false,
      code: 'api_key',
      message:
        'Codex reports API-key authentication. Workroom requires ChatGPT sign-in for this connection. Run npx --no-install codex login and choose Sign in with ChatGPT. No API fallback will be used.',
    };
  if (!/logged in.*chatgpt/is.test(login.output))
    return {
      ready: false,
      code: 'signed_out',
      message:
        'No ChatGPT Codex sign-in was detected for the OS user running Workroom. Use Sign in with ChatGPT on the Connections page, or run npx --no-install codex login in the same Ubuntu terminal and choose ChatGPT, then check connections. Signing into ChatGPT in Chrome alone does not sign the CLI in.',
    };
  return {
    ready: true,
    code: 'authenticated',
    message: `ChatGPT Codex sign-in detected on this computer. ${defaultModel ? 'The default model is configured.' : 'Choose an exact model ID in this project; no default model is configured.'} Generation and remaining subscription allowance have not been tested.`,
  };
}
