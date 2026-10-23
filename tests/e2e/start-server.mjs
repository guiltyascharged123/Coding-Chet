import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'workroom-browser-'));
// Local deterministic model protocol fixture; no real accounts or inference.
const seen = new Set();
const modelServer = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/models') {
    res.end(JSON.stringify({ data: [{ id: 'workroom-browser-model' }] }));
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const request = JSON.parse(raw),
    input = JSON.parse(request.messages.at(-1).content);
  if (input.brief?.includes('E2E planning recovery') && !seen.has(input.brief)) {
    seen.add(input.brief);
    res.statusCode = 503;
    res.end('{}');
    return;
  }
  if (input.meeting) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const chair = request.messages[0].content.includes('Chair this team meeting');
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: chair
                ? JSON.stringify({
                    decision:
                      'Agreed next actions: compare buyer alternatives and test willingness to pay.',
                    rationale:
                      'A concrete test can falsify assumptions before spending or building.',
                    dissent: 'Demand remains unverified and objections have not been resolved.',
                    evidenceGaps: 'No customers or validated demand have been supplied.',
                    actions: [
                      {
                        taskId: input.plannedWork[0]?.taskId || 'next-project',
                        action:
                          'Compare buyer alternatives and record the evidence needed before any spending.',
                      },
                    ],
                  })
                : JSON.stringify({
                    proposal: `Specialist proposal ${input.contributions.length + 1}: a specific buyer must have a costly problem.`,
                    rationale:
                      'A useful comparison needs buyer alternatives and a cheap validation test.',
                    objection: 'Generic AI copy services may have no advantage over ChatGPT.',
                    alternative:
                      'Compare workflow integration that saves measurable operating time.',
                    evidenceGaps: 'Demand, customer access and conversion rates remain unverified.',
                    nextAction:
                      'Compare at least three distinct approaches and define a falsifiable test.',
                  }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    );
    return;
  }
  if (input.task) {
    if (input.project.title.includes('Live console fixture'))
      await new Promise((resolve) => setTimeout(resolve, 4000));
    if (input.project.title.includes('Response recovery fixture'))
      await new Promise((resolve) => setTimeout(resolve, 3000));
    const needsInput =
      input.task.title.includes('Human decision fixture') && !input.humanDirection?.length;
    const result = {
      outcome: needsInput ? 'needs_input' : 'complete',
      summary: 'Compared the supplied options and checked the arithmetic against the assignment.',
      deliverable:
        '# Cost comparison\n\nOption A costs $20 and option B costs $35. The difference is $15. Demand has not been validated; no external actions occurred.',
      checks: [
        {
          criterion: 'Compare the supplied costs',
          status: 'met',
          evidence: '$35 minus $20 equals $15; the result is supplied text, not a transaction.',
        },
      ],
      handoff: {
        facts: ['Supplied costs are $20 and $35.'],
        assumptions: ['Demand is unverified.'],
        next: 'Review the evidence and proceed with the assigned task.',
      },
      decision: needsInput
        ? {
            question: 'Which spending ceiling should guide the experiment?',
            why: 'Only the owner can authorize a budget; no spending will occur automatically.',
            options: ['Use a zero-dollar experiment', 'Plan an experiment capped at $20'],
            recommended: 'Use a zero-dollar experiment',
          }
        : null,
      followUps: [],
      improvements: [
        {
          problem: 'Earlier updates did not distinguish evidence from assumptions.',
          change: 'Always label supplied facts separately from unverified demand assumptions.',
          evidence: 'The cost comparison is supported; no customer evidence has been supplied.',
        },
      ],
    };
    if (input.project.title.includes('Response recovery fixture') && !input.task.revisionFeedback)
      result.checks[0].evidence = '';
    res.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
        usage: { prompt_tokens: 100, completion_tokens: 150 },
      }),
    );
    return;
  }
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tasks: [
                {
                  title: 'Confirm useful scope',
                  description: 'Confirm the requested deliverable and acceptance criteria.',
                  agentId: 'mira',
                  dependencies: [],
                  requiresApproval: true,
                },
                {
                  title: 'Produce the approved result',
                  description: 'Deliver the approved work with evidence.',
                  agentId: 'sol',
                  dependencies: [0],
                  requiresApproval: false,
                },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
  );
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '3107',
    HOST: '127.0.0.1',
    DATABASE_PATH: join(directory, 'test.sqlite'),
    AGENT_PROVIDER: 'demo',
    WORKROOM_DEMO: '1',
    DEMO_STEP_MS: '2000',
    RUNNER_TOKEN: 'browser-test-token-not-a-real-secret',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    WORKROOM_CODEX_ENABLED: '',
    OLLAMA_MODEL: '',
    COMPATIBLE_API_URL: `http://127.0.0.1:${modelPort}/v1`,
    COMPATIBLE_MODEL: 'workroom-browser-model',
    COMPATIBLE_API_KEY: '',
    COMPATIBLE_BILLING: 'local',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
child.on('exit', (code) => {
  modelServer.close();
  rmSync(directory, { recursive: true, force: true });
  process.exit(code || 0);
});
