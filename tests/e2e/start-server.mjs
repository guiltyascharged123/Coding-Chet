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
                ? '# Agreed next actions\n\nCompare buyer alternatives and test willingness to pay. Owner: coordinator. Record unverified demand and objections before any spending.'
                : `# Specialist proposal ${input.contributions.length + 1}\n\nA specific buyer must have a costly problem. Challenge generic AI copy services: why pay instead of using ChatGPT? Compare a distinct alternative and define a cheap validation test.`,
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
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
