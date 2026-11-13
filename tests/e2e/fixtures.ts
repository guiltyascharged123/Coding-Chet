import { test as base, expect } from '@playwright/test';

// Exercise the real session handshake for API setup, as the browser client does.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => sessionStorage.setItem('workroom-browser-key', 'b'.repeat(64)));
    await use(page);
  },
  request: async ({ request }, use) => {
    const response = await request.get('/api/session', {
      headers: { Authorization: `Bearer ${'b'.repeat(64)}` },
    });
    const { token } = await response.json();
    const writes = new Set(['post', 'put', 'patch', 'delete']);
    await use(
      new Proxy(request, {
        get(target, key) {
          const member = Reflect.get(target, key);
          if (writes.has(String(key)))
            return async (url: string, options: any = {}) => {
              // Setup helpers use the current revision; conflict tests pass a deliberately stale one.
              if (
                options.data &&
                options.data.expectedRevision === undefined &&
                /\/plan$|\/team$|\/policy$|\/agents\/|\/projects\/[^/]+\/(?:runtime|instructions)$/.test(
                  url,
                )
              ) {
                const state = (await (await target.get('/api/state')).json()).state;
                const projectId = url.match(/\/projects\/([^/]+)/)?.[1] || options.data.projectId;
                const project = state.projects.find((p: any) => p.id === projectId);
                const expectedRevision = url.endsWith('/policy')
                  ? state.policyRevision || 0
                  : /\/plan$/.test(url)
                    ? project?.planRevision || 0
                    : url.endsWith('/instructions')
                      ? project?.instructionRevision || 0
                      : url.endsWith('/runtime')
                        ? project?.settingsRevision || 0
                        : project?.teamRevision || 0;
                options = {
                  ...options,
                  data: {
                    ...options.data,
                    expectedRevision,
                    ...(url.endsWith('/plan') &&
                    (options.data.collaboration || options.data.toolNetwork !== undefined)
                      ? { expectedSettingsRevision: project?.settingsRevision || 0 }
                      : {}),
                  },
                };
              }
              return member.call(target, url, {
                ...options,
                headers: { 'X-Workroom-CSRF': token, ...options.headers },
              });
            };
          // Node may close an idle keep-alive socket just as an API read starts.
          // Retry only the idempotent GET on transport reset, never a write or
          // an HTTP error response (Playwright's maxRetries behavior).
          if (key === 'get')
            return (url: string, options: any = {}) =>
              member.call(target, url, { maxRetries: 1, ...options });
          return typeof member === 'function' ? member.bind(target) : member;
        },
      }),
    );
  },
});
export { expect };
