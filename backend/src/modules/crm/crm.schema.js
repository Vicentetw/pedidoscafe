const { z } = require('zod');

// '' se normaliza a null: dos clientes con phone/email en '' chocarían
// contra el UNIQUE(tenant_id, phone|email) como si fueran iguales, cosa que
// NULL evita (MySQL no considera NULL duplicado).
const emptyToNull = (schema) => z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());

const createCustomer = z.object({
  code: emptyToNull(z.string().trim().max(40)),
  name: z.string().trim().min(2, 'El nombre es obligatorio.').max(120),
  phone: emptyToNull(z.string().trim().max(30)),
  email: emptyToNull(z.string().trim().email('Ese email no es válido.').max(160)),
  birthDate: emptyToNull(z.string().trim().max(10)), // YYYY-MM-DD
  homeBranchId: z.coerce.number().int().positive().nullable().optional(),
  consent: z.record(z.boolean()).nullable().optional(),
  notes: emptyToNull(z.string().trim().max(500)),
});

const updateCustomer = createCustomer.partial();

const setPreference = z.object({
  value: z.string().trim().min(1).max(500),
});

const linkParticipant = z.object({
  participantId: z.coerce.number().int().positive(),
});

module.exports = { createCustomer, updateCustomer, setPreference, linkParticipant };
