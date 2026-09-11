const { z } = require('zod');

const money = z.coerce.number().positive().max(1e8).multipleOf(0.01);

const chargeSessionStaff = z.object({
  mode: z.enum(['GROUP', 'INDIVIDUAL', 'SPLIT']),
  participantId: z.string().trim().min(10).max(30).optional(), // public_id (ULID) — requerido si mode=INDIVIDUAL
  amount: money.optional(), // requerido si mode=SPLIT
  provider: z.enum(['CASH', 'MERCADOPAGO']),
  tipAmount: z.coerce.number().min(0).max(1e8).multipleOf(0.01).default(0),
  cashSessionId: z.coerce.number().int().positive().optional(), // caja abierta que cobra (opcional)
});
// El comensal sólo paga lo suyo o toda la mesa, y sólo online — el
// efectivo lo cobra el mostrador, no el propio comensal.
const chargeSessionGuest = z.object({
  mode: z.enum(['GROUP', 'INDIVIDUAL']),
  tipAmount: z.coerce.number().min(0).max(1e8).multipleOf(0.01).default(0),
});

const splitEqual = z.object({
  parts: z.coerce.number().int().min(2).max(20),
  cashSessionId: z.coerce.number().int().positive().optional(),
});

const chargeOrder = z.object({
  provider: z.enum(['CASH', 'MERCADOPAGO']),
  tipAmount: z.coerce.number().min(0).max(1e8).multipleOf(0.01).default(0),
  cashSessionId: z.coerce.number().int().positive().optional(),
});

const refund = z.object({
  amount: money.optional(), // sin monto = devolución total de lo que quede pendiente
  reason: z.string().trim().min(2).max(300),
});

module.exports = { chargeSessionStaff, chargeSessionGuest, splitEqual, chargeOrder, refund };
