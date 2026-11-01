import { z } from 'zod';

export const projectUpdateSchema = z.object({
  title: z.string().trim().min(2).max(80),
  brief: z.string().trim().min(20).max(6000),
  reason: z.string().trim().max(1000).default(''),
  expectedUpdatedAt: z.number().finite(),
});
