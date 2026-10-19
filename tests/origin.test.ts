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
