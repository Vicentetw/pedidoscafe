const { z } = require('zod');

const dateStr = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de fecha: YYYY-MM-DD.');

const dateRange = z.object({
  branchId: z.coerce.number().int().positive(),
  from: dateStr,
  to: dateStr,
}).refine((v) => v.from <= v.to, { message: '"from" no puede ser posterior a "to".' });

const topProductsQuery = z.object({
  branchId: z.coerce.number().int().positive(),
  from: dateStr,
  to: dateStr,
  limit: z.coerce.number().int().positive().max(100).optional(),
}).refine((v) => v.from <= v.to, { message: '"from" no puede ser posterior a "to".' });

module.exports = { dateRange, topProductsQuery };
