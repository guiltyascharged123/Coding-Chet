// Child-process errors can include response bodies, prompts, paths, and tokens.
// Return fixed messages for recognized conditions, never raw CLI output.
const suffix = ' No API fallback was attempted.';
const messages = {
  CODEX_AUTH:
    'Codex sign-in failed or expired. Run npx --no-install codex login, restart Workroom, and check connections.',
  CODEX_MODEL:
    'Codex rejected the selected model. Choose a model offered by your ChatGPT Codex account, update WORKROOM_CODEX_MODEL, restart, and explicitly reset this project’s connection in Workspace controls.',
  CODEX_QUOTA:
    'Codex reported a usage or rate limit. Check your account allowance and wait before retrying.',
  CODEX_REASONING:
    'The selected model rejected the reasoning setting. Choose a supported Codex model; the worker currently requests low reasoning effort.',
  CODEX_CONFIG:
    'Codex rejected the worker configuration. Update Workroom and restart. Restrictions remain enabled; do not bypass the sandbox.',
  CODEX_SANDBOX:
    'Codex could not initialize its restricted worker or access its local state. Check local directory permissions and native sandbox support; Workroom will not retry with unrestricted access.',
  CODEX_NETWORK:
    'Codex could not reach its service or lost the connection. Check your network, proxy, and certificate configuration before retrying.',
  CODEX_INSTALL:
    'The Codex executable could not start. Run npm run local to prepare dependencies and check any WORKROOM_CODEX_BIN override.',
  CODEX_TIMEOUT:
    'The Codex job reached its time limit (text: five minutes; software: 15 minutes). Review Usage before retrying; allowance may already have been consumed.',
  CODEX_CANCELLED:
    'The Codex job was cancelled. Review Usage before retrying; allowance may already have been consumed.',
  CODEX_TOOL_BLOCKED:
    'The worker requested a tool that is disabled for this assignment. Workroom stopped it.',
  CODEX_NO_RECEIPT: 'Codex ended without a completion receipt. Review Usage before retrying.',
  CODEX_UNKNOWN:
    'Codex failed without a recognized cause. Confirm CLI sign-in and the selected model. Review Usage before retrying; do not share credential files.',
} as const;

export type CodexErrorCode = keyof typeof messages;
export class CodexWorkerError extends Error {
  constructor(public code: CodexErrorCode) {
    super(`[${code}] ${messages[code]}${suffix}`);
    this.name = 'CodexWorkerError';
  }
}

export function codexFailure(error: unknown): CodexWorkerError {
  if (error instanceof CodexWorkerError) return error;
  const raw = (
    typeof error === 'string'
      ? error
      : error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : ''
  ).slice(0, 32000);
  if (
    /reasoning[\s\S]{0,160}(unsupported|not supported|invalid|not allowed)|unsupported[\s\S]{0,160}reasoning/i.test(
      raw,
    )
  )
    return new CodexWorkerError('CODEX_REASONING');
  if (
    /model_not_found|model[\s\S]{0,160}(not supported|does not exist|not available|not found)|unsupported model/i.test(
      raw,
    )
  )
    return new CodexWorkerError('CODEX_MODEL');
  if (/usage.limit|rate.limit|quota|\b429\b|usage_limit_reached/i.test(raw))
    return new CodexWorkerError('CODEX_QUOTA');
  if (
    /\b401\b|unauthori[sz]ed|not logged in|sign.?in|login required|refresh.token|invalid_grant|authentication/i.test(
      raw,
    )
  )
    return new CodexWorkerError('CODEX_AUTH');
  if (
    /approval_policy|no longer supported|error loading config|failed to load config|invalid configuration|unknown variant|invalid type|permissions\.[\s\S]{0,160}(invalid|unknown)/i.test(
      raw,
    )
  )
    return new CodexWorkerError('CODEX_CONFIG');
  if (
    /sandbox|bubblewrap|\bbwrap\b|landlock|permission denied|operation not permitted|read.only file system/i.test(
      raw,
    )
  )
    return new CodexWorkerError('CODEX_SANDBOX');
  if (/ENOENT|EACCES|unable to locate codex|executable.*not found/i.test(raw))
    return new CodexWorkerError('CODEX_INSTALL');
  if (
    /ECONN|ETIMEDOUT|ENOTFOUND|network|connection|certificate|\bTLS\b|proxy|stream disconnected|error sending request|transport/i.test(
      raw,
    )
  )
    return new CodexWorkerError('CODEX_NETWORK');
  return new CodexWorkerError('CODEX_UNKNOWN');
}
