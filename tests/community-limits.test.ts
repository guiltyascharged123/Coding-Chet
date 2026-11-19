import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communityCompletion } from '../server/community-provider.js';
import { providerResponseError, ProviderRequestError } from '../server/provider-errors.js';
import { COMMUNITY_API_URL, COMMUNITY_ANONYMOUS_KEY } from '../shared/community.js';
import { Store } from '../server/store.js';
import { initialState } from '../server/seed.js';
import { defaultPolicy } from '../shared/schemas.js';
import { guarded } from '../server/policy.js';
import { planProject } from '../server/providers.js';
import { managedInfo } from '../server/managed.js';

const rejection = (limit = 3072) =>
  Response.json(
    {
      error: {
        message: `The workers eligible for this request currently serve up to ${limit} tokens without kudos held upfront. This request needs kudos held upfront.`,
        type: 'permission_error',
        code: 'KudosUpfront',
        metadata: { rc: 'KudosUpfront', retry_after: 0 },
      },
    },
    { status: 403 },
  );
const signal = () => new AbortController().signal;
const body = () => ({
  model: 'public-fixture',
  max_tokens: 8000,
  messages: [{ role: 'user', content: 'Synthetic test request.' }],
});

test('cancelling the provider-requested wait preserves the known pre-inference rejection and sends no second request', async () => {
  const original = globalThis.fetch,
    controller = new AbortController();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    const response = rejection();
    response.headers.set('Retry-After', '30');
    return response;
  }) as typeof fetch;
  try {
    await assert.rejects(
      communityCompletion(body(), controller.signal, undefined, () => controller.abort()),
      (e: unknown) => e instanceof ProviderRequestError && e.rejectedBeforeInference,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('Horde respects the advertised ceiling and negotiates a smaller explicitly allowed free request once', async () => {
  const original = globalThis.fetch,
    calls: any[] = [],
    limits: number[] = [];
  globalThis.fetch = (async (url, options) => {
    assert.equal(String(url), `${COMMUNITY_API_URL}/chat/completions`);
    assert.equal((options!.headers as any).Authorization, `Bearer ${COMMUNITY_ANONYMOUS_KEY}`);
    calls.push(JSON.parse(String(options?.body)));
    return calls.length === 1
      ? rejection()
      : Response.json({ choices: [{ message: { content: 'OK' } }] });
  }) as typeof fetch;
  const request = body(),
    before = structuredClone(request);
  try {
    assert.equal(
      (await communityCompletion(request, signal(), 4096, (n) => limits.push(n))).status,
      200,
    );
    assert.deepEqual(limits, [4096, 3072]);
    assert.deepEqual(
      calls.map((c) => c.max_tokens),
      [4096, 3072],
    );
    assert.deepEqual(calls[0].messages, calls[1].messages);
    assert.deepEqual(request, before);
  } finally {
    globalThis.fetch = original;
  }
});

test('ordinary access failures, rate limits, missing free allowances and repeat rejections never loop or switch providers', async () => {
  const original = globalThis.fetch;
  try {
    for (const make of [
      () =>
        Response.json({ error: { message: 'Access denied', code: 'Forbidden' } }, { status: 403 }),
      () => Response.json({ error: { message: 'Rate limited' } }, { status: 429 }),
      () =>
        Response.json(
          { error: { message: 'Kudos required', code: 'KudosUpfront' } },
          { status: 403 },
        ),
      () => rejection(9000),
      () => {
        const response = rejection();
        response.headers.set('Retry-After', new Date(Date.now() + 3600000).toUTCString());
        return response;
      },
    ]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return make();
      }) as typeof fetch;
      await assert.rejects(communityCompletion(body(), signal()), ProviderRequestError);
      assert.equal(calls, 1);
    }
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return rejection(calls === 1 ? 3072 : 2048);
    }) as typeof fetch;
    await assert.rejects(communityCompletion(body(), signal()), /KudosUpfront/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('provider diagnostics redact credentials and do not dump HTML error pages', async () => {
  const before = process.env.COMPATIBLE_API_KEY;
  process.env.COMPATIBLE_API_KEY = 'private-fixture-must-not-appear';
  try {
    const error = await providerResponseError(
      Response.json(
        {
          error: { message: `Invalid key ${process.env.COMPATIBLE_API_KEY}`, code: 'invalid_key' },
        },
        { status: 403 },
      ),
      'Compatible model server',
    );
    assert.match(error.message, /invalid_key/);
    assert.doesNotMatch(error.message, /private-fixture/);
    const long = await providerResponseError(
      Response.json(
        { error: { message: 'x'.repeat(1195) + process.env.COMPATIBLE_API_KEY } },
        { status: 403 },
      ),
      'Compatible model server',
    );
    assert.ok(
      !long.message.includes(process.env.COMPATIBLE_API_KEY.slice(0, 5)),
      'Redact before clipping so a partial key cannot escape.',
    );
    const html = await providerResponseError(
      new Response('<html>private proxy page</html>', { status: 403 }),
      'AI Horde',
      true,
    );
    assert.match(html.message, /HTML access\/proxy/);
    assert.doesNotMatch(html.message, /<html>|private proxy/);
  } finally {
    if (before === undefined) delete process.env.COMPATIBLE_API_KEY;
    else process.env.COMPATIBLE_API_KEY = before;
  }
});

test('a confirmed pre-inference kudos rejection is not recorded as uncertain inference', async () => {
  const names = ['COMPATIBLE_BILLING', 'COMPATIBLE_API_URL'],
    previous = names.map((n) => process.env[n]);
  process.env.COMPATIBLE_BILLING = 'community';
  process.env.COMPATIBLE_API_URL = COMMUNITY_API_URL;
  const store = new Store(':memory:');
  store.state = initialState(true);
  store.state.policy = { ...defaultPolicy };
  const project = store.state.projects[0];
  project.provider = 'compatible';
  project.model = 'public-fixture';
  try {
    const ctx = { store, project, task: store.state.tasks[0], model: project.model, cache: false };
    await assert.rejects(
      guarded('compatible', 'system', 'synthetic', ctx, async () => {
        throw await providerResponseError(rejection(), 'AI Horde', true);
      }),
      /KudosUpfront/,
    );
    assert.equal(store.attempts()[0].status, 'acknowledged');
    assert.equal(store.hasUncertain('task_id', ctx.task.id), false);
    await assert.rejects(
      guarded('compatible', 'system', 'synthetic', ctx, async () => {
        throw await providerResponseError(
          Response.json({ error: { message: 'Unknown access failure' } }, { status: 403 }),
          'AI Horde',
          true,
        );
      }),
      /Unknown access failure/,
    );
    assert.equal(store.hasUncertain('task_id', ctx.task.id), true);
  } finally {
    store.close();
    names.forEach((n, i) => {
      if (previous[i] === undefined) delete process.env[n];
      else process.env[n] = previous[i];
    });
  }
});

test('the real project adapter uses Horde model metadata without rewriting the workspace output budget (HTTP fixture)', async () => {
  const names = ['COMPATIBLE_BILLING', 'COMPATIBLE_API_URL'],
    previous = names.map((n) => process.env[n]),
    original = globalThis.fetch,
    oldLimits = managedInfo.compatibleOutputLimits;
  process.env.COMPATIBLE_BILLING = 'community';
  process.env.COMPATIBLE_API_URL = COMMUNITY_API_URL;
  managedInfo.compatibleOutputLimits = { 'public-fixture': 512 };
  const store = new Store(':memory:');
  store.state = initialState(true);
  store.state.policy = { ...defaultPolicy, maxOutputTokens: 8000, maxInputBytes: 60000 };
  const project = store.state.projects[0];
  project.provider = 'compatible';
  project.model = 'public-fixture';
  globalThis.fetch = (async (_url, options) => {
    const sent = JSON.parse(String(options?.body));
    assert.equal(sent.max_tokens, 512);
    return Response.json({
      model: project.model,
      choices: [
        {
          message: {
            content: JSON.stringify({
              tasks: [
                {
                  title: 'Check supplied evidence',
                  description: 'Compare only the supplied evidence and report unknowns.',
                  agentId: 'mira',
                  dependencies: [],
                  requiresApproval: false,
                  workType: 'plan',
                },
              ],
            }),
          },
          finish_reason: 'stop',
        },
      ],
    });
  }) as typeof fetch;
  try {
    const plan = await planProject(project, store.state.agents, {
      store,
      project,
      signal: signal(),
    });
    assert.equal(plan.length, 1);
    assert.equal(store.state.policy.maxOutputTokens, 8000);
  } finally {
    store.close();
    globalThis.fetch = original;
    managedInfo.compatibleOutputLimits = oldLimits;
    names.forEach((n, i) => {
      if (previous[i] === undefined) delete process.env[n];
      else process.env[n] = previous[i];
    });
  }
});
