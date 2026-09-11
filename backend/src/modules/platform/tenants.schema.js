const { z } = require('zod');

const slug = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Sólo minúsculas, números y guiones.');

const createTenant = z.object({
  name: z.string().trim().min(2).max(160),
  slug: slug.optional(), // si falta, se deriva del nombre
});

const updateTenant = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  slug: slug.optional(),
  status: z.enum(['active', 'suspended', 'closed']).optional(),
});

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = { createTenant, updateTenant, listQuery, slug };
