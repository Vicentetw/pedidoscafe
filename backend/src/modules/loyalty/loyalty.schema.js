const { z } = require('zod');

const points = z.coerce.number().int().min(1).max(1_000_000);

const manualEarn = z.object({
  points,
  reason: z.string().trim().min(2).max(300),
});
const redeem = z.object({
  points,
  reason: z.string().trim().min(2).max(300),
});
const adjust = z.object({
  points: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'El ajuste no puede ser 0.'),
  reason: z.string().trim().min(2).max(300),
});

const createTier = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'Sólo minúsculas, números, guión y guión bajo.'),
  name: z.string().trim().min(2).max(80),
  minPoints: z.coerce.number().int().min(0),
  multiplier: z.coerce.number().min(0.01).max(99).default(1),
  benefits: z.record(z.any()).nullable().optional(),
});

const createRule = z.object({
  scope: z.string().trim().max(20).default('GLOBAL'),
  pointsPerAmount: z.coerce.number().min(0.0001).max(100),
  active: z.boolean().default(true),
});

module.exports = { manualEarn, redeem, adjust, createTier, createRule };
