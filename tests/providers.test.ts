import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agents, initialState } from '../server/seed.js';
import { planProject, runTask } from '../server/providers.js';
import { result } from './work-fixtures.js';

test('OpenAI planning validates assignments and enforces a downstream human gate', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-placeholder';
  try {
    const proposed = {
      tasks: [
        {
          title: 'Research',
          description: 'Clarify the audience.',
          agentId: 'mira',
          dependencies: [],
          requiresApproval: false,
        },
        {
          title: 'Direction',
          description: 'Propose a direction.',
          agentId: 'sol',
          dependencies: [0],
          requiresApproval: true,
        },
        {
          title: 'Implementation',
          description: 'Plan the implementation.',
          agentId: 'atlas',
          dependencies: [0],
          requiresApproval: false,
        },
      ],
    };
    globalThis.fetch = (async (url, options) => {
      assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(String(options?.body));
      assert.equal(body.response_format.type, 'json_object');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(proposed) } }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const project = { ...initialState().projects[0], provider: 'openai' as const };
    const plan = await planProject(project, agents);
    assert.ok(plan[2].dependencies.includes(plan[1].id));
    proposed.tasks[2].dependencies = [2];
    await assert.rejects(() => planProject(project, agents), /circular dependency/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('Gemini uses a server-side key header and retains revision and teammate context', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-only-placeholder';
  try {
    const state = initialState();
    const task = state.tasks[1];
    task.feedback = 'Please reconsider the hierarchy.';
    const previous = { ...state.tasks[0], output: '# Audience research', status: 'done' as const };
    globalThis.fetch = (async (url, options) => {
      assert.match(String(url), /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\//);
      assert.equal(
        (options?.headers as Record<string, string>)['x-goog-api-key'],
        'test-only-placeholder',
      );
      assert.ok(!String(url).includes('test-only-placeholder'));
      const body = JSON.parse(String(options?.body));
      const content = JSON.parse(body.contents[0].parts[0].text);
      assert.equal(content.task.revisionFeedback, task.feedback);
      assert.equal(content.teammateOutputs[0].output, previous.output);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'PRIVATE_GEMINI_REASONING' },
                  { text: JSON.stringify(result()) },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    assert.equal(
      await runTask(
        'gemini',
        state.projects[0],
        task,
        agents[1],
        [previous],
        new AbortController().signal,
      ),
      result().deliverable,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test('model failures report a useful status without exposing provider response bodies', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response('Do not expose this response body.', { status: 429 })) as typeof fetch;
    const state = initialState();
    await assert.rejects(
      () =>
        runTask(
          'openai',
          state.projects[0],
          state.tasks[0],
          agents[0],
          [],
          new AbortController().signal,
        ),
      (error) =>
        error instanceof Error &&
        /HTTP 429/.test(error.message) &&
        !/response body/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
