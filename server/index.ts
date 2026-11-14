import { RESOURCE_LIMITS, INPUT_LIMITS } from '../shared/limits.js';
import { executorSchema } from '../shared/schemas.js';
import { validationMessages, parseField } from '../shared/validation.js';
import { limitsCatalog } from './limits-catalog.js';
import 'dotenv/config';
import express from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ConnectionSettings, SettingsError } from './connection-settings.js';
import { CodexLogin } from './codex-login.js';
import { Engine, AppError } from './engine.js';
import { Store } from './store.js';
import { allowedHost, allowedOrigin, BrowserSessions } from './origin.js';
// @ts-expect-error Shared Node bootstrap module is intentionally dependency-free JavaScript.
import { runtimeIdentity } from '../scripts/runtime-identity.mjs';
// @ts-expect-error Shared dependency-free launcher capability helper.
import { browserKey, pairedUrl } from '../scripts/browser-key.mjs';
import { acceptanceListSchema } from '../shared/verification.js';
import { collaborationSchema, providerSchema } from '../shared/schemas.js';
import { AGENT_IDS, teamMemberSchema } from '../shared/team.js';
import { ideaProposalSchema } from '../shared/ideas.js';
import { CONSOLE_LIMITS, type ConsoleEntry } from '../shared/console.js';
import { refreshManagedInfo } from './managed.js';
import { localChatRoute } from './local-chat.js';
import { communityChatRoute, communityModelsRoute } from './community-chat.js';
import { projectWorkspace, workspaceFiles, workspaceFile, workspaceZip } from './workspaces.js';

const app = express();
app.disable('x-powered-by');
const accessKey = browserKey(resolve(process.env.WORKROOM_SETTINGS_ROOT || '.'));
const sessions = new BrowserSessions(Buffer.from(accessKey, 'hex'));
// Validate authority and browser session before reading potentially expensive bodies.
app.use((req, res, next) => {
  // Express routes are case-insensitive by default. The boundary must use the
  // same interpretation, including session issuance and the runner protocol.
  const path = req.path.toLowerCase();
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (!allowedHost(req.headers.host, process.env.WORKROOM_ORIGIN))
    return res
      .status(403)
      .json({ error: 'Untrusted request host. Configure WORKROOM_ORIGIN for a trusted proxy.' });
  if (
    req.headers.origin &&
    !allowedOrigin(req.headers.origin, req.headers.host, process.env.WORKROOM_ORIGIN)
  )
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  if (path.startsWith('/api/') && path !== '/api/health' && !path.startsWith('/api/runner/')) {
    const supplied = req.headers.authorization?.replace(/^Bearer /i, '') || '';
    const pairing =
      path === '/api/session' &&
      Buffer.byteLength(supplied) === Buffer.byteLength(accessKey) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(accessKey));
    if (!pairing && !sessions.authenticated(req.headers.cookie))
      return res.status(401).json({
        code: 'BROWSER_PAIRING_REQUIRED',
        error:
          'Connect this browser using the private Workroom link printed in the server terminal.',
      });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (path.startsWith('/api/runner/')) {
      const expected = process.env.RUNNER_TOKEN || '';
      const supplied = req.headers.authorization?.replace(/^Bearer /i, '') || '';
      if (
        expected.length < 24 ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        return res
          .status(401)
          .json({ error: 'A valid server-configured RUNNER_TOKEN is required.' });
    } else if (!sessions.accepts(req.headers.cookie, req.get('X-Workroom-CSRF'))) {
      return res.status(403).json({
        code: 'SESSION_REQUIRED',
        error: 'Refresh the browser session before making changes.',
      });
    }
  }
  next();
});
app.get('/api/session', (req, res) => {
  const token = sessions.issue(req.headers.cookie);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Set-Cookie',
    `workroom_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.WORKROOM_ORIGIN?.startsWith('https://') ? '; Secure' : ''}`,
  );
  res.json({ token });
});
app.use((req, res, next) =>
  express.json({
    limit:
      req.path.toLowerCase().replace(/\/+$/, '') === '/api/restore'
        ? RESOURCE_LIMITS.restoreBytes
        : RESOURCE_LIMITS.requestBytes,
    inflate: false,
  })(req, res, next),
);
const identity = runtimeIdentity(resolve('.'));
const store = new Store(process.env.DATABASE_PATH || resolve('.data/workroom.sqlite'));
await refreshManagedInfo();
const engine = new Engine(store);
const connectionSettings = new ConnectionSettings(
  process.env.WORKROOM_SETTINGS_ROOT || resolve('.'),
);
let shuttingDown = false;
const codexLogin = new CodexLogin({
  acquire: () => engine.beginConnectionChange('ChatGPT sign-in is pending.'),
  release: (owner) => {
    if (!shuttingDown) engine.endConnectionChange(owner);
  },
});
const route =
  (handler: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
const param = (req: express.Request, key: string) => String(req.params[key]);

async function reconcileSignIn() {
  const login = codexLogin.state().login;
  if (login && ['starting', 'waiting', 'stopping'].includes(login.status)) {
    const checked = await codexLogin.check();
    if (checked.login?.status === 'completed') await refreshManagedInfo();
  }
}
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    ...identity,
    service: 'workroom',
    mode: process.env.WORKROOM_DEMO === '1' ? 'demo' : 'workspace',
    workspaceId: createHash('sha256').update(resolve('.')).digest('hex').slice(0, 16),
  }),
);
app.get('/api/state', (_req, res) => res.json(engine.bootstrap()));
app.post('/api/local-chat', localChatRoute());
app.get('/api/community-models', communityModelsRoute);
app.post('/api/community-chat', communityChatRoute());
app.get(
  '/api/limits',
  route((req, res) => {
    const id = parseField(z.string().max(100).optional(), 'projectId', req.query);
    res.json(limitsCatalog(store, id ? engine.project(id) : undefined));
  }),
);
app.get(
  '/api/projects/:id/directions',
  route((req, res) => {
    const project = engine.project(param(req, 'id'));
    res.json({
      entries: (engine.state.projectMessages || []).filter(
        (message) =>
          message.projectId === project.id &&
          message.active !== false &&
          (message.kind === 'direction' || (!message.kind && !message.responseTaskId)),
      ),
    });
  }),
);
app.get(
  '/api/projects/:id/plan-history',
  route((req, res) => {
    engine.project(param(req, 'id'));
    const before = parseField(
      z.coerce.number().int().nonnegative().optional(),
      'before',
      req.query,
    );
    res.json({ entries: store.planVersions(param(req, 'id'), before) });
  }),
);
app.get(
  '/api/attempts',
  route((req, res) => {
    const query = z
      .object({
        before: z.string().max(300).optional(),
        status: z.enum(['uncertain', 'completed', 'running', 'cached', 'acknowledged']).optional(),
        projectId: z.string().max(100).optional(),
        taskId: z.string().max(100).optional(),
      })
      .parse(req.query);
    res.json({ ...store.attemptsPage(query), usage: store.usageSummary(query.projectId) });
  }),
);
for (const [path, kind] of [
  ['messages', 'message'],
  ['ideas', 'idea'],
] as const)
  app.get(
    `/api/projects/:id/${path}`,
    route((req, res) => {
      engine.project(param(req, 'id'));
      res.json(
        store.historyPage(
          kind,
          param(req, 'id'),
          parseField(z.string().max(300).optional(), 'before', req.query),
        ),
      );
    }),
  );
app.patch(
  '/api/projects/:id/messages/:messageId',
  route((req, res) => {
    engine.setDirection(
      param(req, 'id'),
      param(req, 'messageId'),
      parseField(z.boolean(), 'active', req.body),
    );
    res.json({ ok: true });
  }),
);
app.get(
  '/api/projects/:id/activity',
  route((req, res) => {
    const project = engine.project(param(req, 'id'));
    const query = z
      .object({
        before: z.coerce.number().int().positive().optional(),
        type: z.enum(['system', 'started', 'message', 'completed', 'approval', 'error']).optional(),
      })
      .parse(req.query);
    res.json(store.activityPage(project.id, query.before, query.type));
  }),
);
app.post(
  '/api/tasks/:id/recover',
  route((req, res) => {
    engine.recoverTask(param(req, 'id'));
    res.json({ ok: true });
  }),
);
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
app.get(
  '/api/projects/:id/console',
  route((req, res) => {
    const project = engine.project(param(req, 'id'));
    res.json({ entries: store.consoleEntries(project.id), limits: CONSOLE_LIMITS });
  }),
);
app.get(
  '/api/projects/:id/console/events',
  route((req, res) => {
    const project = engine.project(param(req, 'id'));
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: string, value: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    const update = (value: { entry: ConsoleEntry; removed: string[] }) => {
      if (value.entry.projectId === project.id || value.removed.length)
        send('update', {
          entry: value.entry.projectId === project.id ? value.entry : undefined,
          removed: value.removed,
        });
    };
    engine.on('console', update);
    const warning = (value: { projectId: string; message: string }) => {
      if (value.projectId === project.id) send('warning', value);
    };
    engine.on('console_warning', warning);
    // Send a fresh bounded snapshot on reconnect, including updates to an earlier SDK item.
    send('snapshot', { entries: store.consoleEntries(project.id), limits: CONSOLE_LIMITS });
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => {
      clearInterval(heartbeat);
      engine.off('console', update);
      engine.off('console_warning', warning);
    });
  }),
);
app.post(
  '/api/projects',
  route(async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(2).max(INPUT_LIMITS.projectTitle),
        brief: z.string().trim().min(20).max(INPUT_LIMITS.projectBrief),
        documentPack: z.enum(['studio', 'office']).default('office'),
        planning: z.enum(['template', 'ai', 'manual']).optional(),
        requestId: z.string().uuid().optional(),
        collaboration: collaborationSchema
          .extend({ exploration: z.enum(['focused', 'expansive']).optional() })
          .optional(),
        officeCapacity: z.union([z.literal(4), z.literal(8), z.literal(12)]).default(4),
        team: z.array(teamMemberSchema).min(1).max(12).optional(),
        workflow: z.enum(['office', 'software', 'research', 'venture', 'custom']).optional(),
      })
      .parse(req.body);
    const project = await engine.createProject(
      body.title,
      body.brief,
      body.documentPack,
      body.planning ||
        (engine.state.provider === 'external'
          ? 'manual'
          : engine.state.provider === 'demo' && process.env.WORKROOM_DEMO === '1'
            ? 'template'
            : 'ai'),
      body.requestId,
      body.workflow || (Object.hasOwn(req.body, 'documentPack') ? undefined : 'office'),
      body.collaboration,
      body.officeCapacity,
      body.team,
    );
    res.status(201).json({ project });
  }),
);
app.put(
  '/api/projects/:id',
  route((req, res) => {
    res.json({ project: engine.updateProject(param(req, 'id'), req.body) });
  }),
);
app.post(
  '/api/projects/:id/restart',
  route(async (req, res) => {
    const body = z
      .object({
        requestId: z.string().uuid(),
        title: z.string().trim().min(2).max(INPUT_LIMITS.projectTitle),
        mode: z.enum(['replan', 'reuse']),
        officeCapacity: z.union([z.literal(4), z.literal(8), z.literal(12)]).optional(),
      })
      .parse(req.body);
    res.status(201).json({
      project: await engine.restartProject(
        param(req, 'id'),
        body.requestId,
        body.title,
        body.mode,
        body.officeCapacity,
      ),
    });
  }),
);
app.put(
  '/api/projects/:id/team',
  route((req, res) => {
    const body = z
      .object({
        capacity: z.union([z.literal(4), z.literal(8), z.literal(12)]),
        expectedRevision: z.number().int().nonnegative(),
        members: z
          .array(
            z.object({
              id: z.enum(AGENT_IDS),
              name: z.string().trim().min(1).max(30),
              role: z.string().trim().min(2).max(50),
              specialty: z.string().trim().min(5).max(600),
              goal: z.string().max(1000).optional(),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
              desk: z.number().int().min(0).max(11),
            }),
          )
          .min(1)
          .max(12),
      })
      .parse(req.body);
    engine.configureTeam(param(req, 'id'), body.capacity, body.members, body.expectedRevision);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/projects/:id/messages',
  route((req, res) => {
    const body = z
      .object({
        id: z.string().uuid(),
        content: z.string().trim().min(1).max(2000),
        askCoordinator: z.boolean(),
        kind: z.enum(['direction', 'question']).optional(),
        respondAsAgentId: z.enum(AGENT_IDS).optional(),
        supersedesMessageId: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json({
      message: engine.postProjectMessage(
        param(req, 'id'),
        body.id,
        body.content,
        body.askCoordinator,
        {
          kind: body.kind,
          respondAsAgentId: body.respondAsAgentId,
          supersedesMessageId: body.supersedesMessageId,
        },
      ),
    });
  }),
);
app.post(
  '/api/projects/:id/ideas',
  route((req, res) => {
    const body = ideaProposalSchema.extend({ id: z.string().uuid() }).parse(req.body);
    res.status(201).json({ idea: engine.addIdea(param(req, 'id'), body.id, body) });
  }),
);
app.patch(
  '/api/projects/:id/ideas/:ideaId',
  route((req, res) => {
    const body = z.object({ status: z.enum(['selected', 'rejected', 'proposed']) }).parse(req.body);
    engine.decideIdea(param(req, 'id'), param(req, 'ideaId'), body.status);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/projects/:id/ideas/:ideaId/investigate',
  route((req, res) => {
    const body = z
      .object({ requestId: z.string().uuid(), agentId: z.enum(AGENT_IDS) })
      .parse(req.body);
    res.json({
      task: engine.investigateIdea(
        param(req, 'id'),
        param(req, 'ideaId'),
        body.requestId,
        body.agentId,
      ),
    });
  }),
);
app.post(
  '/api/projects/:id/retry-planning',
  route(async (req, res) => {
    await reconcileSignIn();
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
          title: z.string().trim().min(1).max(INPUT_LIMITS.taskTitle),
          description: z.string().trim().min(1).max(INPUT_LIMITS.taskDescription),
          agentId: z.string(),
          dependencies: z.array(z.string()).max(100),
          requiresApproval: z.boolean(),
          readOnly: z.boolean().optional(),
          workType: z.enum(['plan', 'implementation', 'review', 'tests']).optional(),
          documentKind: z
            .enum([
              'brief',
              'project_plan',
              'budget',
              'risk_register',
              'meeting_minutes',
              'status_report',
              'notes',
            ])
            .optional(),
          acceptanceCriteria: acceptanceListSchema.optional(),
        }),
      )
      .min(1)
      .max(100)
      .parse(req.body.tasks);
    engine.editPlan(
      param(req, 'id'),
      rows as import('../shared/types.js').Task[],
      parseField(z.boolean().optional(), 'toolNetwork', req.body),
      req.body.collaboration,
      parseField(z.number().int().nonnegative(), 'expectedRevision', req.body),
      req.body.collaboration !== undefined || req.body.toolNetwork !== undefined
        ? parseField(z.number().int().nonnegative(), 'expectedSettingsRevision', req.body)
        : undefined,
    );
    res.json({ ok: true });
  }),
);
app.put(
  '/api/projects/:id/collaboration',
  route((req, res) => {
    engine.configureCollaboration(
      param(req, 'id'),
      req.body,
      parseField(z.number().int().nonnegative(), 'expectedRevision', req.body),
      parseField(z.boolean().optional(), 'toolNetwork', req.body),
    );
    res.json({ ok: true });
  }),
);
app.post(
  '/api/projects/:id/meetings',
  route((req, res) => {
    const { agenda, participants } = z
      .object({
        agenda: z.string().trim().min(10).max(3000),
        participants: z.array(z.enum(AGENT_IDS)).min(1).max(12).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json({ meeting: engine.startMeeting(param(req, 'id'), agenda, 'manual', participants) });
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
    const bytes = workspaceFile(codingFolder(req), parseField(z.string(), 'path', req.query));
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
  route(async (req, res) => {
    await reconcileSignIn();
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
  route(async (req, res) => {
    await reconcileSignIn();
    engine.retryTask(
      param(req, 'id'),
      parseField(z.string().max(4000).optional(), 'feedback', req.body),
    );
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
        desk: z.number().int().min(0).max(11),
        goal: z.string().trim().max(1000).optional(),
        projectId: z.string().optional(),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(req.body);
    engine.updateAgent(param(req, 'id'), body, body.projectId, body.expectedRevision);
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
    engine.updatePolicy(
      req.body,
      parseField(z.number().int().nonnegative(), 'expectedRevision', req.body),
    );
    res.json({ ok: true, revision: engine.state.policyRevision || 0 });
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
        executor: executorSchema.nullable().optional(),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(req.body);
    engine.setProjectProvider(
      param(req, 'id'),
      value.provider,
      value.model,
      value.workMode,
      value.expectedRevision,
      value.executor,
    );
    res.json({ ok: true, revision: engine.project(param(req, 'id')).settingsRevision });
  }),
);
app.put(
  '/api/projects/:id/instructions',
  route((req, res) => {
    const value = z
      .object({ text: z.string().trim().max(4000), reason: z.string().trim().min(5).max(1000) })
      .parse(req.body);
    engine.updateInstructions(
      param(req, 'id'),
      value.text,
      value.reason,
      parseField(z.number().int().nonnegative(), 'expectedRevision', req.body),
    );
    res.json({ ok: true, revision: engine.project(param(req, 'id')).instructionRevision });
  }),
);
app.get('/api/connections/settings', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(connectionSettings.view());
});
app.put(
  '/api/connections/settings',
  route(async (req, res) => {
    const owner = engine.beginConnectionChange('Applying connection settings.');
    try {
      const settings = connectionSettings.save(req.body);
      // Preserve the immutable build/database identity captured when this process started.
      identity.configId = runtimeIdentity(resolve('.')).configId;
      await refreshManagedInfo(true);
      res.setHeader('Cache-Control', 'no-store');
      engine.endConnectionChange(owner);
      res.json({ settings, data: engine.bootstrap() });
    } catch (error) {
      engine.endConnectionChange(owner);
      throw error;
    }
  }),
);
async function loginSnapshot(
  res: express.Response,
  operation: Promise<import('../shared/codex-connection.js').CodexConnectionState>,
  refresh = false,
) {
  const state = await operation;
  if (refresh || state.login?.status === 'completed') await refreshManagedInfo();
  engine.commit();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...state, data: engine.bootstrap() });
}
app.get(
  '/api/connections/codex/login',
  route((_req, res) => loginSnapshot(res, codexLogin.check())),
);
app.post(
  '/api/connections/codex/login',
  route((req, res) => {
    const options = z
      .object({
        mode: z.enum(['browser', 'device']).default('browser'),
        reconnect: z.boolean().default(false),
      })
      .parse(req.body || {});
    return loginSnapshot(res, codexLogin.start(options.mode, options.reconnect));
  }),
);
app.post(
  '/api/connections/codex/login/check',
  route((_req, res) => loginSnapshot(res, codexLogin.check(true), true)),
);
app.post(
  '/api/connections/codex/login/reset',
  route((req, res) => {
    const { id } = z.object({ id: z.string().uuid().optional() }).parse(req.body || {});
    return loginSnapshot(res, codexLogin.reset(id), true);
  }),
);
// Keep old clients' cancel button functional after an update.
app.post(
  '/api/connections/codex/login/cancel',
  route((req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    return loginSnapshot(res, codexLogin.reset(id), true);
  }),
);
app.post(
  '/api/connections/check',
  route(async (req, res) => {
    const { projectId, useCurrentSignIn } = z
      .object({ projectId: z.string().optional(), useCurrentSignIn: z.boolean().default(false) })
      .parse(req.body || {});
    const project = projectId ? engine.project(projectId) : undefined;
    await codexLogin.check(useCurrentSignIn);
    await refreshManagedInfo(true, project);
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
  (error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error:
          validationMessages(error, req.body).join('; ').slice(0, 3500) +
          ' Check the named fields. Workspace controls → Limits reference lists field and resource constraints.',
        issues: validationMessages(error, req.body),
      });
    if (error instanceof SettingsError)
      return res.status(error.status).json({ error: error.message });
    if (error instanceof AppError)
      return res.status(error.status).json({ error: error.message, action: error.action });
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      [413, 415].includes(Number(error.status))
    )
      return res.status(Number(error.status)).json({
        error:
          Number(error.status) === 413
            ? `The request exceeds the ${req.path.toLowerCase().replace(/\/+$/, '') === '/api/restore' ? RESOURCE_LIMITS.restoreBytes : RESOURCE_LIMITS.requestBytes}-byte ${req.path.toLowerCase().includes('restore') ? 'backup restore' : 'API edit'} limit${req.headers['content-length'] ? ` (received ${req.headers['content-length']} bytes)` : ''}. No changes were applied. Split the edit, or use a stopped .data folder copy for larger backups. See Workspace controls → Limits reference.`
            : 'Compressed request bodies are not supported.',
      });
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
  console.log(
    `Open Workroom: ${pairedUrl(process.env.WORKROOM_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3001}`, accessKey)}`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    shuttingDown = true;
    engine.stop();
    void codexLogin.shutdown();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500).unref();
  });
