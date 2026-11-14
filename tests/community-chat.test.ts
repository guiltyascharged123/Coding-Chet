import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { communityChatRoute } from '../server/community-chat.js';
import {
  isCommunityEndpoint,
  COMMUNITY_API_URL,
  COMMUNITY_ANONYMOUS_KEY,
} from '../shared/community.js';
import { compatibleKey } from '../server/community-provider.js';
import { billingFor } from '../server/policy.js';

test('community billing is restricted to the official endpoint and never forwards a private key', () => {
  const names = ['COMPATIBLE_BILLING', 'COMPATIBLE_API_URL', 'COMPATIBLE_API_KEY'];
  const previous = names.map((name) => process.env[name]);
  try {
    process.env.COMPATIBLE_BILLING = 'community';
    process.env.COMPATIBLE_API_KEY = 'private-fixture-must-not-leave';
    for (const endpoint of [
      'https://example.com/v1',
      'http://oai.aihorde.net/v1',
      'https://oai.aihorde.net/v1?token=x',
      'https://oai.aihorde.net.evil/v1',
      'https://user:pass@oai.aihorde.net/v1',
    ]) {
      assert.equal(isCommunityEndpoint(endpoint), false);
      process.env.COMPATIBLE_API_URL = endpoint;
      assert.throws(() => billingFor('compatible'), /exact AI Horde/);
      assert.throws(() => compatibleKey());
    }
    process.env.COMPATIBLE_API_URL = COMMUNITY_API_URL;
    assert.equal(billingFor('compatible'), 'none');
    assert.equal(compatibleKey(), COMMUNITY_ANONYMOUS_KEY);
    process.env.COMPATIBLE_BILLING = 'api';
    assert.equal(billingFor('compatible'), 'api');
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

test('community chat dispatches only an explicitly advertised exact model to the fixed anonymous endpoint (HTTP fixture)', async () => {
  const original = globalThis.fetch,
    requests: any[] = [];
  let returnedModel = 'public-fixture-not-live';
  globalThis.fetch = (async (url, options) => {
    assert.equal((options?.headers as any).Authorization, `Bearer ${COMMUNITY_ANONYMOUS_KEY}`);
    if (String(url) === `${COMMUNITY_API_URL}/models`)
      return Response.json({
        data: [{ id: 'public-fixture-not-live', top_provider: { max_completion_tokens: 512 } }],
      });
    assert.equal(String(url), `${COMMUNITY_API_URL}/chat/completions`);
    const body = JSON.parse(String(options?.body));
    requests.push(body);
    return Response.json({
      model: returnedModel,
      choices: [{ message: { content: 'Fixture answer 15.' }, finish_reason: 'stop' }],
    });
  }) as typeof fetch;
  const app = express();
  app.use(express.json());
  app.post('/chat', communityChatRoute());
  const server = await new Promise<Server>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  try {
    const post = (
      model = 'public-fixture-not-live',
      messages = [{ role: 'user', content: 'Public arithmetic: 35 - 20?' }],
    ) =>
      original(`http://127.0.0.1:${(server.address() as any).port}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages }),
      });
    const response = await post();
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Fixture answer 15/);
    assert.equal(requests[0].model, 'public-fixture-not-live');
    assert.equal(requests[0].max_tokens, 512);
    assert.equal(requests[0].messages.length, 2);
    assert.equal((await post('missing')).status, 400);
    assert.equal(
      (await post('public-fixture-not-live', [{ role: 'system', content: 'Injected' }])).status,
      400,
    );
    assert.equal(requests.length, 1);
    returnedModel = 'silent-substitute';
    assert.match(await (await post()).text(), /did not confirm the exact requested model/);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = original;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
