const { z } = require('zod');

const code = z.string().trim().min(1).max(48);

// Ítem — SÓLO códigos y cantidad. El precio lo pone el backend (§15).
const itemInput = z.object({
  productCode: code,
  variantCode: code.nullable().optional(),
  modifierCodes: z.array(code).max(20).default([]),
  qty: z.coerce.number().int().min(1).max(99).default(1),
  note: z.string().trim().max(300).optional(),
});

const createOrderStaff = z.object({
  branchId: z.coerce.number().int().positive(),
  sessionId: z.coerce.number().int().positive().nullable().optional(),
  customerId: z.coerce.number().int().positive().nullable().optional(), // CRM (Fase 9) — típico en mostrador
  channel: z.enum(['TABLE', 'COUNTER', 'TAKEAWAY', 'DELIVERY']).default('COUNTER'),
  note: z.string().trim().max(500).optional(),
});
const createOrderGuest = z.object({
  note: z.string().trim().max(500).optional(),
});
const updateItem = z.object({ qty: z.coerce.number().int().min(1).max(99) });
const cancelOrder = z.object({ reason: z.string().trim().max(300).optional() });
const setPriority = z.object({ priority: z.enum(['NORMAL', 'URGENT', 'VIP', 'LATE']) });
const ageCheck = z.object({ result: z.enum(['VERIFIED', 'REJECTED']) });

// -------- KDS / estaciones
const createStation = z.object({
  branchId: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/, 'Sólo minúsculas, números, guión y guión bajo.'),
  name: z.string().trim().min(2).max(80),
  type: z.enum(['KITCHEN', 'BAR', 'COFFEE', 'COLD', 'DESSERT']).default('KITCHEN'),
  isDefault: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
});
const setRouting = z.object({
  productId: z.coerce.number().int().positive().nullable().optional(),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  stationId: z.coerce.number().int().positive(),
});

module.exports = {
  itemInput, createOrderStaff, createOrderGuest, updateItem, cancelOrder, setPriority, ageCheck,
  createStation, setRouting,
};
