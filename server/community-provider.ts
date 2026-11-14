import { COMMUNITY_ANONYMOUS_KEY, isCommunityEndpoint } from '../shared/community.js';

export function communityConnection() {
  if (process.env.COMPATIBLE_BILLING !== 'community') return false;
  if (!isCommunityEndpoint(process.env.COMPATIBLE_API_URL || ''))
    throw new Error(
      'Free community mode requires the exact AI Horde HTTPS endpoint. Other remote services require API spending controls.',
    );
  return true;
}
export function compatibleKey() {
  // Never forward a previously configured provider's private key to volunteers.
  return communityConnection()
    ? COMMUNITY_ANONYMOUS_KEY
    : process.env.COMPATIBLE_API_KEY || 'local';
}
