import { z } from 'zod';

export const acceptanceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  description: z.string().trim().min(1).max(300),
  evidence: z.enum(['artifact', 'verification', 'inspection', 'report']),
});
export const acceptanceListSchema = z
  .array(acceptanceSchema)
  .min(1)
  .max(10)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'Acceptance IDs must be unique',
  );
export const observationSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(['artifact', 'verification', 'inspection']),
  reference: z.string().max(1500),
  detail: z.string().max(2000),
});
export type Observation = z.infer<typeof observationSchema>;
