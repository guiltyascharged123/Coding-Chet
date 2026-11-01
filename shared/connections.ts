import type { ConnectionInfo, Provider, RuntimeInfo } from './types.js';
import { modelReadiness } from './model-readiness.js';

export function connectionInfo(
  runtime: RuntimeInfo,
  provider: Provider,
  model?: string,
): ConnectionInfo {
  const selected =
    model || (provider === 'demo' || provider === 'external' ? '' : runtime.models[provider]);
  if (model === undefined && runtime.available[provider] && runtime.connections?.[provider])
    return runtime.connections[provider]!;
  const readiness = modelReadiness(runtime, provider, model);
  if (!readiness.ready)
    return {
      state: runtime.connections?.[provider]?.state === 'disabled' ? 'disabled' : 'unavailable',
      message: readiness.message,
    };
  const checked =
    runtime.modelConnections?.[provider as 'openai' | 'gemini']?.[selected] ||
    runtime.connections?.[provider];
  // An API metadata check for another model must not certify this project's ID.
  if (checked && (!checked.model || checked.model === selected)) return checked;
  return {
    state: 'configured',
    message:
      'Configured, but this model connection has not been checked. Check connections to query metadata without generating work.',
  };
}

export const CONNECTION_LABELS: Record<ConnectionInfo['state'], string> = {
  connected: 'Connected',
  configured: 'Not checked',
  unavailable: 'Unavailable',
  disabled: 'Disabled',
};
