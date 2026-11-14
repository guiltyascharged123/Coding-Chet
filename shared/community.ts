export const COMMUNITY_API_URL = 'https://oai.aihorde.net/v1';
// Intentionally public, documented anonymous access token, not a user credential.
export const COMMUNITY_ANONYMOUS_KEY = '0000000000';
export const COMMUNITY_EXAMPLE_MODEL = 'koboldcpp/G4-MeroMero-26B-A4B-it-uncensored-heretic';
export function isCommunityEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'oai.aihorde.net' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.replace(/\/$/, '') === '/v1'
    );
  } catch {
    return false;
  }
}
