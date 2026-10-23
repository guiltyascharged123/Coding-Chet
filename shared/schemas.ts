import { z } from 'zod';
import { decisionSchema, workResultSchema } from './work.js';
export const providers = [
  'demo',
  'openai',
  'gemini',
  'external',
  'codex',
  'ollama',
  'compatible',
] as const;
export const providerSchema = z.enum(providers);
export const defaultPolicy = {
  allowPaid: false,
  maxConcurrent: 1,
  maxTasks: 30,
  maxRevisions: 1,
  maxRequests24h: 30,
  maxInputBytes: 24000,
  maxOutputTokens: 2000,
  dailyBudgetUsd: 2,
  projectBudgetUsd: 1,
  rates: {},
};
const rate = z.object({
  model: z.string().min(1).max(150),
  inputPerMillion: z.number().finite().min(0).max(1000),
  outputPerMillion: z.number().finite().min(0).max(1000),
});
export const policySchema = z.object({
  allowPaid: z.boolean(),
  maxConcurrent: z.number().int().min(1).max(4),
  maxTasks: z.number().int().min(1).max(100),
  maxRevisions: z.number().int().min(0).max(20),
  maxRequests24h: z.number().int().min(1).max(10000),
  maxInputBytes: z.number().int().min(2000).max(200000),
  maxOutputTokens: z.number().int().min(256).max(16000),
  dailyBudgetUsd: z.number().finite().min(0).max(1000),
  projectBudgetUsd: z.number().finite().min(0).max(1000),
  rates: z.object({
    openai: rate.optional(),
    gemini: rate.optional(),
    compatible: rate.optional(),
  }),
});
const id = z.string().min(1).max(100),
  text = z.string();
export const collaborationSchema = z.object({
  reasoningEffort: z.enum(['low', 'medium', 'high']).default('medium'),
  researchEnabled: z.boolean().default(false),
  meetingPolicy: z.object({ enabled: z.boolean(), everyTasks: z.number().int().min(1).max(20) }),
});
export const meetingSchema = z.object({
  id,
  projectId: id,
  agenda: text.min(1).max(3000),
  trigger: z.enum(['manual', 'kickoff', 'checkpoint']),
  status: z.enum(['gathering', 'running', 'completed', 'failed', 'cancelled']),
  checkpoint: z.number().int().min(0),
  participants: z
    .array(
      z.object({
        id,
        name: text.min(1).max(30),
        role: text.min(2).max(50),
        specialty: text.min(5).max(600),
        color: text.regex(/^#[0-9a-fA-F]{6}$/),
        desk: z.number().int().min(0).max(3),
        goal: text.max(1000).optional(),
      }),
    )
    .length(4),
  contributions: z
    .array(
      z.object({
        agentId: id,
        role: text.max(50),
        content: text.max(20000),
        createdAt: z.number().finite(),
      }),
    )
    .max(4),
  summary: text.max(20000),
  speakerId: id.optional(),
  error: text.max(4000).optional(),
  createdAt: z.number().finite(),
  completedAt: z.number().finite().optional(),
});
export const memorySchema = z.object({
  id,
  projectId: id,
  content: text.trim().min(1).max(3000),
  status: z.enum(['proposed', 'verified']),
  sourceTaskId: id.optional(),
  sourceHash: text.max(64).optional(),
  createdAt: z.number().finite(),
});
export const stateSchema = z
  .object({
    schemaVersion: z.number().int().optional(),
    provider: providerSchema,
    policy: policySchema.optional(),
    memory: z.array(memorySchema).max(1000).optional(),
    meetings: z.array(meetingSchema).max(2000).optional(),
    agents: z
      .array(
        z.object({
          id: z.enum(['mira', 'sol', 'atlas', 'echo']),
          name: text.min(1).max(30),
          role: text.min(2).max(50),
          specialty: text.min(5).max(600),
          color: text.regex(/^#[0-9a-fA-F]{6}$/),
          desk: z.number().int().min(0).max(3),
          goal: text.max(1000).optional(),
        }),
      )
      .length(4),
    projects: z
      .array(
        z.object({
          id,
          title: text.min(2).max(80),
          brief: text.min(1).max(6000),
          status: z.enum(['ready', 'running', 'paused', 'needs_input', 'completed']),
          createdAt: z.number().finite(),
          provider: providerSchema,
          documentPack: z.enum(['studio', 'office']).optional(),
          model: text.max(150).optional(),
          planning: z.enum(['template', 'ai']).optional(),
          planningStatus: z.enum(['planning', 'failed', 'ready']).optional(),
          planningError: text.max(4000).optional(),
          workflow: z.enum(['office', 'software', 'research', 'venture', 'custom']).optional(),
          reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
          researchEnabled: z.boolean().optional(),
          instructionHistory: z
            .array(
              z.object({
                id,
                text: text.max(4000),
                reason: text.max(1000),
                createdAt: z.number().finite(),
              }),
            )
            .max(50)
            .optional(),
          meetingPolicy: collaborationSchema.shape.meetingPolicy.optional(),
          team: z
            .array(
              z.object({
                id,
                name: text.min(1).max(30),
                role: text.min(2).max(50),
                specialty: text.min(5).max(600),
                color: text.regex(/^#[0-9a-fA-F]{6}$/),
                desk: z.number().int().min(0).max(3),
                goal: text.max(1000).optional(),
              }),
            )
            .length(4)
            .optional(),
          workspaceFolder: text.regex(/^[a-z0-9-]{1,160}$/).optional(),
          toolNetwork: z.boolean().optional(),
          workMode: z.enum(['text', 'workspace']).optional(),
        }),
      )
      .max(1000),
    tasks: z
      .array(
        z.object({
          id,
          projectId: id,
          title: text.min(1).max(100),
          description: text.max(4000),
          agentId: id,
          dependencies: z.array(id).max(100),
          status: z.enum(['queued', 'working', 'review', 'done', 'failed']),
          requiresApproval: z.boolean(),
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
          output: text.max(200000),
          feedback: text.max(4000),
          error: text.max(4000).optional(),
          startedAt: z.number().finite().optional(),
          completedAt: z.number().finite().optional(),
          revisions: z.number().int().min(0).optional(),
          attemptId: id.optional(),
          leaseId: id.optional(),
          leaseExpiresAt: z.number().finite().optional(),
          toolLog: z
            .array(
              z.object({
                id,
                type: text.max(50),
                detail: text.max(2000),
                status: text.max(50).optional(),
              }),
            )
            .max(100)
            .optional(),
          readOnly: z.boolean().optional(),
          result: workResultSchema.optional(),
          coordinationRounds: z.number().int().min(0).max(20).optional(),
          contextReport: z
            .object({
              inputBytes: z.number().int().min(0),
              originalBytes: z.number().int().min(0),
              limit: z.number().int().min(0),
              sources: z
                .array(
                  z.object({
                    id: text.max(200),
                    label: text.max(100),
                    totalCharacters: z.number().int().min(0),
                    includedCharacters: z.number().int().min(0),
                  }),
                )
                .max(20000),
            })
            .optional(),
        }),
      )
      .max(10000),
    activities: z
      .array(
        z.object({
          id,
          projectId: id,
          agentId: id.optional(),
          targetAgentId: id.optional(),
          type: z.enum(['system', 'started', 'message', 'completed', 'approval', 'error']),
          message: text.max(5000),
          createdAt: z.number().finite(),
        }),
      )
      .max(1000),
    approvals: z
      .array(
        z.object({
          id,
          projectId: id,
          taskId: id,
          question: text.max(3000),
          decision: decisionSchema.optional(),
          resumeTask: z.boolean().optional(),
          status: z.enum(['pending', 'approved', 'revision']),
          feedback: text.max(6000).optional(),
          createdAt: z.number().finite(),
        }),
      )
      .max(10000),
  })
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const unique = (rows: { id: string }[]) => new Set(rows.map((r) => r.id)).size === rows.length;
    if (
      ![
        s.agents,
        s.projects,
        s.tasks,
        s.approvals,
        s.activities,
        s.memory || [],
        s.meetings || [],
      ].every(unique) ||
      new Set(s.agents.map((a) => a.desk)).size !== 4
    )
      fail('Duplicate IDs or desk assignments.');
    const projects = new Set(s.projects.map((p) => p.id)),
      agents = new Set<string>(s.agents.map((a) => a.id)),
      tasks = new Map(s.tasks.map((t) => [t.id, t]));
    for (const m of s.meetings || []) {
      const participants = new Set(m.participants.map((a) => a.id));
      if (
        !projects.has(m.projectId) ||
        participants.size !== 4 ||
        m.participants.some((a) => !agents.has(a.id)) ||
        m.contributions.some((c) => !participants.has(c.agentId)) ||
        new Set(m.contributions.map((c) => c.agentId)).size !== m.contributions.length ||
        (m.speakerId && !participants.has(m.speakerId))
      )
        fail('Invalid meeting references.');
    }
    for (const p of s.projects)
      if (
        p.team &&
        (new Set(p.team.map((a) => a.id)).size !== 4 ||
          p.team.some((a) => !agents.has(a.id)) ||
          new Set(p.team.map((a) => a.desk)).size !== 4)
      )
        fail('Invalid project team.');
    for (const t of s.tasks)
      if (
        !projects.has(t.projectId) ||
        !agents.has(t.agentId) ||
        t.dependencies.some((d) => tasks.get(d)?.projectId !== t.projectId)
      )
        fail('Invalid task reference.');
    for (const a of s.approvals)
      if (tasks.get(a.taskId)?.projectId !== a.projectId) fail('Invalid approval reference.');
    for (const m of s.memory || [])
      if (
        !projects.has(m.projectId) ||
        (m.sourceTaskId && tasks.get(m.sourceTaskId)?.projectId !== m.projectId)
      )
        fail('Invalid memory source.');
    const completed = new Set<string>();
    for (let count = 0; count <= s.tasks.length; count++) {
      let added = 0;
      for (const t of s.tasks)
        if (!completed.has(t.id) && t.dependencies.every((d) => completed.has(d))) {
          completed.add(t.id);
          added++;
        }
      if (!added) break;
    }
    if (completed.size !== s.tasks.length) fail('Cyclic task dependencies.');
  });
export const attemptSchema = z.object({
  id,
  projectId: id,
  taskId: id.optional(),
  provider: providerSchema,
  model: text.max(150).optional(),
  billing: z.enum(['api', 'subscription', 'local', 'external', 'none']).optional(),
  phase: z.enum(['plan', 'task', 'meeting']),
  meetingId: id.optional(),
  status: z.enum(['running', 'completed', 'uncertain', 'cached', 'acknowledged']),
  createdAt: z.number().finite(),
  reservedUsd: z.number().finite().min(0),
  actualUsd: z.number().finite().min(0).optional(),
  inputTokens: z.number().finite().min(0).optional(),
  outputTokens: z.number().finite().min(0).optional(),
  error: text.max(4000).optional(),
});
export const backupSchema = z.object({
  format: z.literal('workroom'),
  version: z.literal(2),
  createdAt: z.number().finite(),
  state: stateSchema,
  attempts: z.array(attemptSchema).max(50000),
});
