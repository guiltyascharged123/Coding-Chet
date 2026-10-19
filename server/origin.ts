export function allowedOrigin(origin: string, host: string | undefined, configuredOrigin?: string) {
  try {
    const requested = new URL(origin);
    if (requested.protocol !== 'http:' && requested.protocol !== 'https:') return false;
    return (
      requested.host === host ||
      (!!configuredOrigin && requested.origin === new URL(configuredOrigin).origin)
    );
  } catch {
    return false;
  }
}
