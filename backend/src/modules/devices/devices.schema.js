const { z } = require('zod');

const createDevice = z.object({
  branchId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/, 'Sólo letras, números, guión y guión bajo.'),
  kind: z.enum(['BUZZER', 'PRINTER', 'KDS_SCREEN']).default('BUZZER'),
});

const setStatus = z.object({ status: z.enum(['AVAILABLE', 'ASSIGNED', 'OFFLINE']) });

const assignDevice = z.object({ deviceCode: z.string().trim().min(1).max(40) });

module.exports = { createDevice, setStatus, assignDevice };
