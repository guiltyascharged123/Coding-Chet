import type { Provider, RuntimeInfo } from './types.js';

// Provider reachability and exact model availability are deliberately separate.
// Metadata is not a promise about generation quota or quality.
export function modelReadiness(runtime: RuntimeInfo, provider: Provider, model?: string) {
  if (!runtime.available[provider])
    return {
      ready: false,
      message:
        runtime.diagnostics?.[provider] ||
        'The connection is not configured. Check Model connections.',
    };
  const selected =
    model || (provider === 'demo' || provider === 'external' ? '' : runtime.models[provider]);
  const listed = runtime.listedModels?.[provider as 'ollama' | 'compatible'];
  if (listed && !listed.includes(selected))
    return {
      ready: false,
      message: `The connected service does not list project model “${selected}”. Install that exact model or select an installed model, then check connections.`,
    };
  if (provider !== 'demo' && provider !== 'external' && !selected)
    return { ready: false, message: 'Choose an exact model ID for this project.' };
  return {
    ready: true,
    message: 'Connection configured. Generation access is checked when work runs.',
  };
}
