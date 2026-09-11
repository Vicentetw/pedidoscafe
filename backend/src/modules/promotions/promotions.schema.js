const { z } = require('zod');

// BOGO/COMBO/FREE_ITEM/HAPPY_HOUR están en el enum (mismo que ARQUITECTURA_V1)
// pero el service rechaza crearlas — ver FASE11.md.
const createPromotion = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'Sólo minúsculas, números, guión y guión bajo.'),
  name: z.string().trim().min(2).max(120),
  type: z.enum(['PERCENT', 'FIXED', 'BOGO', 'COMBO', 'FREE_ITEM', 'HAPPY_HOUR']),
  value: z.coerce.number().positive().optional(),
  priority: z.coerce.number().int().default(0),
  stackable: z.boolean().default(false),
  activeFrom: z.string().trim().nullable().optional(),
  activeTo: z.string().trim().nullable().optional(),
});

const conditionType = z.enum(['BRANCH', 'CATEGORY', 'PRODUCT', 'TIME', 'DAY', 'MIN_QTY', 'CUSTOMER_TIER', 'MIN_AMOUNT']);
const createRule = z.object({
  conditionType,
  operator: z.string().trim().max(10).default('EQ'),
  value: z.record(z.any()),
});

const setStatus = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

module.exports = { createPromotion, createRule, setStatus };
