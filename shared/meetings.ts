import { z } from 'zod';
export const contributionSchema = z.object({
  proposal: z.string().min(20).max(1200),
  rationale: z.string().min(20).max(1000),
  objection: z.string().min(20).max(1000),
  alternative: z.string().min(20).max(1000),
  evidenceGaps: z.string().min(10).max(1000),
  nextAction: z.string().min(20).max(1000),
});
export const chairSchema = z.object({
  decision: z.string().min(20).max(1500),
  rationale: z.string().min(20).max(1000),
  dissent: z.string().min(10).max(1000),
  evidenceGaps: z.string().min(10).max(1000),
  actions: z
    .array(z.object({ taskId: z.string().min(1), action: z.string().min(20).max(800) }))
    .min(1)
    .max(4),
});
