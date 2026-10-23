import 'dotenv/config';
import express from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Engine, AppError } from './engine.js';
import { Store } from './store.js';
import { allowedOrigin } from './origin.js';
import { collaborationSchema, providerSchema } from '../shared/schemas.js';
import { refreshManagedInfo } from './managed.js';
import { projectWorkspace, workspaceFiles, workspaceFile, workspaceZip } from './workspaces.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method !== 'GET' && req.headers.origin) {
    if (!allowedOrigin(req.headers.origin, req.headers.host, process.env.WORKROOM_ORIGIN))
      return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
  }
  next();
});
const store = new Store(process.env.DATABASE_PATH || resolve('.data/workroom.sqlite'));
await refreshManagedInfo();
const engine = new Engine(store);
const route =
  (handler: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
const param = (req: express.Request, key: string) => String(req.params[key]);

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'workroom',
    mode: process.env.WORKROOM_DEMO === '1' ? 'demo' : 'workspace',
    workspaceId: createHash('sha256').update(resolve('.')).digest('hex').slice(0, 16),
  }),
);
app.get('/api/state', (_req, res) => res.json(engine.bootstrap()));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = () => res.write(`data: ${JSON.stringify(engine.bootstrap())}\n\n`);
  send();
  engine.on('change', send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    engine.off('change', send);
  });
});
engine.setMaxListeners(100);
app.post(
  '/api/projects',
  route(async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(2).max(80),
        brief: z.string().trim().min(20).max(6000),
        documentPack: z.enum(['studio', 'office']).default('office'),
        planning: z.enum(['template', 'ai']).default('template'),
        requestId: z.string().uuid().optional(),
        collaboration: collaborationSchema.optional(),
        workflow: z.enum(['office', 'software', 'research', 'venture', 'custom']).optional(),
      })
      .parse(req.body);
    const project = await engine.createProject(
      body.title,
      body.brief,
      body.documentPack,
      body.planning,
      body.requestId,
      body.workflow || (Object.hasOwn(req.body, 'documentPack') ? undefined : 'office'),
      body.collaboration,
    );
    res.status(201).json({ project });
  }),
);
app.post(
  '/api/projects/:id/retry-planning',
  route((req, res) => {
    engine.retryPlanning(param(req, 'id'));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/projects/:id/starter-plan',
  route((req, res) => {
    engine.starterPlan(param(req, 'id'));
    res.json({ ok: true });
  }),
);
app.put(
  '/api/projects/:id/plan',
  route((req, res) => {
    const rows = z
      .array(
        z.object({
          id: z.string().uuid(),
          title: z.string().trim().min(1).max(100),
          description: z.string().trim().min(1).max(4000),
          agentId: z.string(),
          dependencies: z.array(z.string()).max(100),
          requiresApproval: z.boolean(),
          readOnly: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(100)
      .parse(req.body.tasks);
    engine.editPlan(
      param(req, 'id'),
      rows as import('../shared/types.js').Task[],
      z.boolean().optional().parse(req.body.toolNetwork),
      req.body.collaboration,
    );
    res.json({ ok: true });
  }),
);
app.put(
  '/api/projects/:id/collaboration',
  route((req, res) => {
    engine.configureCollaboration(param(req, 'id'), req.body);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/projects/:id/meetings',
  route((req, res) => {
    const { agenda } = z.object({ agenda: z.string().trim().min(10).max(3000) }).parse(req.body);
    res.status(201).json({ meeting: engine.startMeeting(param(req, 'id'), agenda) });
  }),
);
app.post(
  '/api/meetings/:id/:action',
  route((req, res) => {
    const action = z.enum(['retry', 'skip', 'stop']).parse(req.params.action);
    if (action === 'retry') engine.retryMeeting(param(req, 'id'));
    else if (action === 'skip') engine.skipMeeting(param(req, 'id'));
    else engine.stopMeeting(param(req, 'id'));
    res.json({ ok: true });
  }),
);
function codingFolder(req: express.Request) {
  const project = engine.project(param(req, 'id'));
  if (!project.workspaceFolder) throw new AppError('This project has no managed workspace.');
  return projectWorkspace(store.path, project);
}
app.get(
  '/api/projects/:id/files',
  route((req, res) => {
    const folder = codingFolder(req);
    res.json({ folder, files: workspaceFiles(folder) });
  }),
);
app.get(
  '/api/projects/:id/file',
  route((req, res) => {
    const bytes = workspaceFile(codingFolder(req), z.string().parse(req.query.path));
    res.type('text/plain').send(bytes);
  }),
);
app.get(
  '/api/projects/:id/source.zip',
  route((req, res) => {
    const bytes = Buffer.from(workspaceZip(codingFolder(req)));
    res.attachment('project-source.zip').type('application/zip').send(bytes);
  }),
);
app.post(
  '/api/projects/:id/run',
  route((req, res) => {
    engine.runProject(param(req, 'id'));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/projects/:id/pause',
  route((req, res) => {
    engine.pauseProject(param(req, 'id'));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/tasks/:id/retry',
  route((req, res) => {
    engine.retryTask(param(req, 'id'), z.string().max(4000).optional().parse(req.body.feedback));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/approvals/:id',
  route((req, res) => {
    const body = z
      .object({
        decision: z.enum(['approve', 'revise']),
        feedback: z.string().trim().max(4000).default(''),
        choice: z.string().trim().max(300).optional(),
      })
      .parse(req.body);
    engine.review(param(req, 'id'), body.decision, body.feedback, body.choice);
    res.json({ ok: true });
  }),
);
app.patch(
  '/api/agents/:id',
  route((req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(30),
        role: z.string().trim().min(2).max(50),
        specialty: z.string().trim().min(5).max(600),
        desk: z.number().int().min(0).max(3),
        goal: z.string().trim().max(1000).optional(),
        projectId: z.string().optional(),
      })
      .parse(req.body);
    engine.updateAgent(param(req, 'id'), body, body.projectId);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/runtime',
  route((req, res) => {
    engine.setProvider(z.object({ provider: providerSchema }).parse(req.body).provider);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/backup',
  route((_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="workroom-backup.json"');
    res.json(store.backup());
  }),
);
app.post(
  '/api/restore',
  route((req, res) => {
    engine.restore(req.body);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/policy',
  route((req, res) => {
    engine.updatePolicy(req.body);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/attempts/:id/acknowledge',
  route((req, res) => {
    engine.acknowledge(param(req, 'id'));
    res.json({ ok: true });
  }),
);
app.post(
  '/api/projects/:id/runtime',
  route((req, res) => {
    const value = z
      .object({
        provider: providerSchema,
        model: z.string().trim().max(150).optional(),
        workMode: z.enum(['text', 'workspace']).optional(),
      })
      .parse(req.body);
    engine.setProjectProvider(param(req, 'id'), value.provider, value.model, value.workMode);
    res.json({ ok: true });
  }),
);
app.put(
  '/api/projects/:id/instructions',
  route((req, res) => {
    const value = z
      .object({ text: z.string().trim().max(4000), reason: z.string().trim().min(5).max(1000) })
      .parse(req.body);
    engine.updateInstructions(param(req, 'id'), value.text, value.reason);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/connections/check',
  route(async (_req, res) => {
    await refreshManagedInfo(true);
    engine.commit();
    res.json(engine.bootstrap());
  }),
);
app.post(
  '/api/projects/:id/memory',
  route((req, res) => {
    const b = z
      .object({ content: z.string().trim().min(1).max(3000), sourceTaskId: z.string().optional() })
      .parse(req.body);
    engine.addMemory(param(req, 'id'), b.content, b.sourceTaskId);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/memory/:id',
  route((req, res) => {
    engine.changeMemory(param(req, 'id'), z.enum(['verify', 'delete']).parse(req.body.action));
    res.json({ ok: true });
  }),
);

app.use('/api/runner', (req, res, next) => {
  const expected = process.env.RUNNER_TOKEN || '';
  const supplied = req.headers.authorization?.replace(/^Bearer /i, '') || '';
  if (
    expected.length < 24 ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return res.status(401).json({ error: 'A valid server-configured RUNNER_TOKEN is required.' });
  next();
});
app.post(
  '/api/runner/claim',
  route((req, res) => {
    const body = z.object({ agentId: z.string().optional() }).parse(req.body);
    res.json({ assignment: engine.claim(body.agentId) });
  }),
);
const lease = z.object({ leaseId: z.string().uuid() });
app.post(
  '/api/runner/tasks/:id/events',
  route((req, res) => {
    const body = lease.extend({ message: z.string().trim().max(1000).optional() }).parse(req.body);
    engine.workerEvent(param(req, 'id'), body.leaseId, body.message);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/runner/tasks/:id/complete',
  route((req, res) => {
    const body = lease.extend({ output: z.string().trim().min(1).max(200000) }).parse(req.body);
    engine.workerComplete(param(req, 'id'), body.leaseId, body.output);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/runner/tasks/:id/fail',
  route((req, res) => {
    const body = lease.extend({ error: z.string().trim().min(1).max(2000) }).parse(req.body);
    engine.workerFail(param(req, 'id'), body.leaseId, body.error);
    res.json({ ok: true });
  }),
);
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
if (existsSync(resolve('dist/index.html'))) {
  app.use(express.static(resolve('dist')));
  app.get('*', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
      });
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError && 'body' in error)
      return res.status(400).json({ error: 'Invalid JSON request.' });
    // Provider errors are deliberately sanitized in providers.ts; never log credentials.
    console.error(error instanceof Error ? error.message : 'Unknown server error');
    res.status(500).json({
      error: error instanceof Error ? error.message : 'The server could not complete this request.',
    });
  },
);
const server = app.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1', () => {
  engine.start();
  console.log(`Workroom runtime listening on port ${process.env.PORT || 3001}`);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    engine.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500).unref();
  });
