import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import { runTask } from '../server/providers.js';
import { managedInfo } from '../server/managed.js';
import { specialistAgent } from '../shared/team.js';
import { DEFAULT_LOCAL_MODEL, DEFAULT_OLLAMA_URL } from '../shared/defaults.js';
import type { Task } from '../shared/types.js';

if (process.argv.includes('--help')) {
  console.log(
    'npm run evaluate:local\nRuns three real Ollama specialist requests (plus bounded format repairs/retrieval). Uses OLLAMA_URL and OLLAMA_MODEL from .env. No installation, model download, or paid API fallback. Saves isolated SQLite/JSON receipts under .data/evaluations/. Quality requires human inspection.',
  );
} else {
  const root = resolve(import.meta.dirname, '..');
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  process.env.AGENT_PROVIDER = 'ollama';
  const model = process.env.OLLAMA_MODEL || DEFAULT_LOCAL_MODEL;
  const endpoint = new URL(process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL);
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Evaluation requires a local Ollama HTTP endpoint without credentials.');
  const response = await fetch(new URL('/api/tags', endpoint), {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Ollama model list returned HTTP ${response.status}.`);
  const tags = (await response.json()) as { models?: { name?: string; model?: string }[] };
  if (!tags.models?.some((entry) => (entry.name || entry.model) === model))
    throw new Error(
      `Exact model ${model} is not installed. Run npm run setup:local or explicitly set OLLAMA_MODEL. No substitute was used.`,
    );
  Object.assign(managedInfo, { ollamaReady: true, ollamaModels: [model] });
  const folder = join(
    process.env.WORKROOM_EVALUATION_ROOT || join(root, '.data', 'evaluations'),
    `${Date.now()}-${randomUUID()}`,
  );
  mkdirSync(folder, { recursive: true });
  const store = new Store(join(folder, 'evaluation.sqlite'));
  const engine = new Engine(store);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  const startedAt = Date.now();
  let error: string | undefined;
  try {
    const project = await engine.createProject(
      'Live local specialist evaluation',
      'Evaluate specialists on independent, bounded assignments. Each task supplies its own inputs. Keep arithmetic-test prices separate from the repair-shop experiment: they are not shop costs or process measurements. Produce actual answers, testable mechanisms and honest evidence limits.',
      'office',
      'manual',
      randomUUID(),
      'custom',
    );
    project.model = model;
    project.exploration = 'expansive';
    // These bounded evaluations request answers/proposals, not a real shop run.
    store.state.policy!.maxRevisions = 0;
    project.requestTimeoutSeconds = 900;
    project.team = [
      specialistAgent(0, 'Data analyst'),
      specialistAgent(1, 'Operations specialist'),
      specialistAgent(2, 'Quality & test engineer'),
      specialistAgent(3, 'Project coordinator'),
    ];
    const cases = [
      {
        title: 'Check supplied arithmetic',
        description:
          'Calculate B minus A from supplied prices $35 and $20. Show the operation and state what it establishes. Complete this small text assignment without delegating.',
        criterion: 'Correctly compute the supplied difference without inventing demand.',
      },
      {
        title: 'Invent a discriminating experiment',
        description:
          'A volunteer repair shop has one expert, four novices, six benches and no budget. Reduce the expert bottleneck without buying equipment or inventing measurements. Compare a direct baseline with two materially different mechanisms, borrowing one from another field. Describe actual workflow steps and why they relieve the bottleneck; category names such as "cross-domain hybrid" are not mechanisms. Deliver a no-budget test proposal, observable outcome and stop condition. This is a text-only connection: mark the experiment unexecuted, and any module only proposed. Do not delegate or execute this bounded proposal assignment.',
        criterion:
          'Provide distinct causal mechanisms and a bounded test with assumptions labeled.',
      },
      {
        title: 'Challenge the actual results independently',
        description:
          'Review the two independent assignments against their original inputs and criteria, supplied with the teammate outputs. Arithmetic prices are not repair-shop measurements. Verify the arithmetic and challenge the shop candidate mechanisms. Identify an unsupported assumption, a failure case, and a better or cheaper distinguishing test. Do not claim the shop experiment ran. Complete your review without delegating.',
        criterion:
          'Check original inputs and distinguish proposed experiments from observed results.',
      },
    ];
    for (const [index, example] of cases.entries()) {
      controller.signal.throwIfAborted();
      project.exploration = index === 0 ? 'focused' : 'expansive';
      const task: Task = {
        id: randomUUID(),
        projectId: project.id,
        title: example.title,
        description: example.description,
        agentId: project.team[index].id,
        dependencies: index === 2 ? store.state.tasks.map((prior) => prior.id) : [],
        requiresApproval: false,
        status: 'working',
        output: '',
        feedback: '',
        workType: index === 2 ? 'review' : 'plan',
        acceptanceCriteria: [{ id: 'c1', description: example.criterion, evidence: 'report' }],
      };
      store.state.tasks.push(task);
      store.save();
      console.log(`Requesting ${project.team[index].role}: ${task.title}`);
      try {
        task.output = await runTask(
          'ollama',
          project,
          task,
          project.team[index],
          store.state.tasks.filter((prior) => prior.id !== task.id && !!prior.result),
          controller.signal,
          {
            store,
            project,
            task,
            cache: false,
            onAttempt: (id) => {
              task.attemptId = id;
            },
            onContext: () => store.save(),
            onTrace: (event) =>
              store.putConsole({
                ...event,
                id: randomUUID(),
                projectId: project.id,
                taskId: task.id,
                phase: 'task',
                provider: 'ollama',
                model,
              }),
          },
        );
        task.status = task.result?.outcome === 'complete' ? 'done' : 'failed';
        if (task.status === 'failed') {
          task.error = `Model reported ${task.result?.outcome}; inspect saved result.`;
          error ||= task.error;
          process.exitCode = 1;
          // Preserve failed work as unaccepted evidence for the independent review.
        }
      } catch (failure) {
        task.status = 'failed';
        task.error = failure instanceof Error ? failure.message : String(failure);
        throw failure;
      } finally {
        store.save();
      }
    }
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
    process.exitCode = 1;
  } finally {
    writeFileSync(
      join(folder, 'receipt.json'),
      JSON.stringify(
        {
          kind: 'ollama-evaluation',
          model,
          startedAt,
          finishedAt: Date.now(),
          error,
          quality:
            'Not automatically scored. Inspect arithmetic, mechanism diversity, assumptions and the independent reviewer’s actual findings. A structurally valid response is not proof of quality.',
          tasks: store.state.tasks,
          attempts: store.attempts(),
        },
        null,
        2,
      ),
    );
    console.log(
      `Receipts: ${folder}${error ? `\nFailed: ${error}` : '\nRequests completed. Inspect receipt.json for actual quality.'}`,
    );
    process.removeListener('SIGINT', cancel);
    engine.stop();
    store.close();
  }
}
