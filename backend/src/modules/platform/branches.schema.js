const { z } = require('zod');

const code = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'Sólo letras, números, guión y guión bajo.');

const address = z
  .object({
    street: z.string().trim().max(200).optional(),
    city: z.string().trim().max(120).optional(),
    province: z.string().trim().max(120).optional(),
    zip: z.string().trim().max(20).optional(),
    notes: z.string().trim().max(300).optional(),
  })
  .strict()
  .nullable()
  .optional();

const createBranch = z.object({
  code,
  name: z.string().trim().min(2).max(160),
  timezone: z.string().trim().max(64).default('America/Argentina/Buenos_Aires'),
  address,
  status: z.enum(['active', 'closed']).default('active'),
});

const updateBranch = z.object({
  code: code.optional(),
  name: z.string().trim().min(2).max(160).optional(),
  timezone: z.string().trim().max(64).optional(),
  address,
  status: z.enum(['active', 'closed']).optional(),
});

module.exports = { createBranch, updateBranch };
