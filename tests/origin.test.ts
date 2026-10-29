import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin } from '../server/origin.js';

test('local writes and the configured Codespaces browser origin work without trusting arbitrary forwarded hosts', () => {
  assert.equal(allowedOrigin('http://127.0.0.1:3000', '127.0.0.1:3000'), true);
  assert.equal(
    allowedOrigin(
      'https://studio-3000.app.github.dev',
      'localhost:3000',
      'https://studio-3000.app.github.dev',
    ),
    true,
  );
  assert.equal(
    allowedOrigin(
      'https://unrelated.example',
      'localhost:3000',
      'https://studio-3000.app.github.dev',
    ),
    false,
  );
  assert.equal(
    allowedOrigin(
      'https://studio-3000.app.github.dev.attacker.example',
      'localhost:3000',
      'https://studio-3000.app.github.dev',
    ),
    false,
  );
  assert.equal(allowedOrigin('null', 'localhost:3000'), false);
  assert.equal(allowedOrigin('file:///tmp/anything', ''), false);
});

test('matching untrusted Host and Origin never establish trust; session writes require a signed cookie and header', async () => {
  const { allowedHost, BrowserSessions } = await import('../server/origin.js');
  assert.equal(allowedOrigin('http://evil.example:3001', 'evil.example:3001'), false);
  assert.equal(allowedHost('localhost.attacker.example:3001'), false);
  assert.equal(allowedHost('127.0.0.1@attacker.example:3001'), false);
  assert.equal(allowedHost('[::1]:3001'), true);
  assert.equal(allowedHost('studio.app.github.dev', 'https://studio.app.github.dev'), true);
  const sessions = new BrowserSessions();
  const token = sessions.issue();
  assert.equal(sessions.accepts(undefined, token), false);
  assert.equal(sessions.accepts(`workroom_session=${token}`, undefined), false);
  assert.equal(sessions.accepts(`workroom_session=${token}`, token + 'x'), false);
  assert.equal(sessions.accepts(`workroom_session=${token}`, token), true);
  assert.equal(new BrowserSessions().accepts(`workroom_session=${token}`, token), false);
});
