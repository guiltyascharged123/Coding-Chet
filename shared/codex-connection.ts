export type CodexAuthProof = {
  command: 'npx --no-install codex login status';
  checkedAt: number;
  code: 'authenticated' | 'signed_out' | 'api_key' | 'cli_unavailable' | 'check_failed';
  message: string;
  exitCode: number | null;
};
export type CodexLoginMode = 'browser' | 'device';
export type CodexLoginState = {
  id: string;
  mode: CodexLoginMode;
  status: 'starting' | 'waiting' | 'stopping' | 'completed' | 'failed' | 'cancelled';
  url?: string;
  code?: string;
  message: string;
  expiresAt: number;
};
export type CodexConnectionState = {
  revision: number;
  login: CodexLoginState | null;
  proof: CodexAuthProof | null;
};
