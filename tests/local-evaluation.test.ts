import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { result } from './work-fixtures.js';

// This server is a deterministic protocol fixture, not live-model validation.
test('local evaluation calls the real CLI and HTTP adapter, preserves receipts and independently supplies prior results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'workroom-eval-fixture-'));
  const inputs: any[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: 'evaluation-fixture-not-live' }] }));
      return;
    }
    assert.equal(request.url, '/api/chat');
    let body = '';
    for await (const chunk of request) body += chunk;
    const packet = JSON.parse(body),
      input = JSON.parse(packet.messages[1].content);
    inputs.push(input);
    response.end(
      JSON.stringify({
        message: {
          content: !packet.format
            ? result().deliverable
            : JSON.stringify({
                outcome: 'complete',
                checks: [
                  {
                    criterion: 'c1: ' + input.task.acceptanceCriteria[0].description,
                    status: 'met',
                    evidence: 'Deterministic evaluation fixture, not live inference.',
                  },
                ],
              }),
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 100,
        eval_count: 100,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/evaluate-local.ts'], {
      env: {
        ...process.env,
        OLLAMA_URL: `http://127.0.0.1:${address.port}`,
        OLLAMA_MODEL: 'evaluation-fixture-not-live',
        WORKROOM_EVALUATION_ROOT: root,
        WORKROOM_OLLAMA_INTERACTION: 'artifact-first',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 0, output);
    assert.equal(inputs.length, 6);
    assert.deepEqual(
      inputs.map((input) => input.agentContext.role),
      [
        'Data analyst',
        'Data analyst',
        'Operations specialist',
        'Operations specialist',
        'Quality & test engineer',
        'Quality & test engineer',
      ],
    );
    assert.equal(inputs[4].teammateOutputs.length, 2);
    assert.match(
      inputs[4].teammateOutputs[0].output,
      /self-reported status and checks are intentionally omitted/,
    );
    assert.equal(inputs[1].localTurn.purpose, 'initial');
    const receipt = JSON.parse(
      readFileSync(join(root, readdirSync(root)[0], 'receipt.json'), 'utf8'),
    );
    assert.equal(receipt.attempts.length, 6);
    assert.ok(
      receipt.attempts.every(
        (attempt: any) => attempt.provider === 'ollama' && attempt.status === 'completed',
      ),
    );
    assert.match(receipt.quality, /Not automatically scored/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
