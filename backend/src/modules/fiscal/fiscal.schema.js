const { z } = require('zod');

const cuit = z.string().trim().regex(/^\d{11}$/, 'El CUIT son 11 dígitos, sin guiones.').nullable().optional();

const setConfig = z.object({
  cuit,
  pointOfSaleNo: z.coerce.number().int().min(1).max(9999).nullable().optional(),
  environment: z.enum(['HOMOLOGACION', 'PRODUCCION']).default('HOMOLOGACION'),
  defaultDocType: z.enum(['TICKET', 'A', 'B', 'C']).default('TICKET'),
});

const createTaxRate = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'Sólo minúsculas, números, guión y guión bajo.'),
  name: z.string().trim().min(2).max(80),
  rate: z.coerce.number().min(0).max(100),
  isDefault: z.boolean().default(false),
});

const issueDocument = z.object({
  customerDocType: z.enum(['CF', 'DNI', 'CUIT']).default('CF'),
  customerDocNo: z.string().trim().max(20).optional(),
});

module.exports = { setConfig, createTaxRate, issueDocument };
