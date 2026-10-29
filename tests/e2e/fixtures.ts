import { test as base, expect } from '@playwright/test';

// Exercise the real session handshake for API setup, as the browser client does.
export const test = base.extend({
  request: async ({ request }, use) => {
    const response = await request.get('/api/session');
    const { token } = await response.json();
    const writes = new Set(['post', 'put', 'patch', 'delete']);
    await use(
      new Proxy(request, {
        get(target, key) {
          const member = Reflect.get(target, key);
          if (writes.has(String(key)))
            return (url: string, options: any = {}) =>
              member.call(target, url, {
                ...options,
                headers: { 'X-Workroom-CSRF': token, ...options.headers },
              });
          return typeof member === 'function' ? member.bind(target) : member;
        },
      }),
    );
  },
});
export { expect };
