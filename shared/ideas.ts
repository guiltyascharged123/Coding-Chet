import { z } from 'zod';
export const ideaProposalSchema = z.object({
  title: z.string().trim().min(1).max(100),
  proposal: z.string().trim().min(1).max(1200),
  rationale: z.string().trim().min(1).max(600),
  nextStep: z.string().trim().min(1).max(400),
});
export type IdeaProposal = z.infer<typeof ideaProposalSchema>;
export const ideaSchema = ideaProposalSchema.extend({
  id: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  status: z.enum(['proposed', 'investigating', 'evaluated', 'selected', 'rejected']),
  authorAgentId: z.string().max(100).optional(),
  authorName: z.string().max(30),
  authorRole: z.string().max(50),
  createdBy: z.enum(['user', 'model']),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite().optional(),
  sourceTaskId: z.string().max(100).optional(),
  sourceMeetingId: z.string().max(100).optional(),
  investigationTaskId: z.string().max(100).optional(),
  evaluation: z.string().max(1200).optional(),
});
export type ProjectIdea = z.infer<typeof ideaSchema>;
