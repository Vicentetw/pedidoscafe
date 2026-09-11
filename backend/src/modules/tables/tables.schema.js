const { z } = require('zod');

const tableCode = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Sólo letras, números, guión y guión bajo.');

const createTable = z.object({
  branchId: z.coerce.number().int().positive(),
  code: tableCode,
  name: z.string().trim().max(80).optional(),
  seats: z.coerce.number().int().min(1).max(50).default(2),
  zone: z.string().trim().max(40).optional(),
});

const updateTable = z.object({
  name: z.string().trim().max(80).optional(),
  seats: z.coerce.number().int().min(1).max(50).optional(),
  zone: z.string().trim().max(40).optional(),
  status: z.enum(['FREE', 'RESERVED', 'OCCUPIED', 'BILL_REQUESTED', 'CLOSING']).optional(),
});

// Staff abre una sesión desde el salón.
const openSession = z.object({
  tableId: z.coerce.number().int().positive(),
  assignSelfAsWaiter: z.boolean().default(false),
});

const assignWaiter = z.object({
  waiterUserId: z.coerce.number().int().positive().nullable(),
});

const closeSession = z.object({
  reason: z.string().trim().max(300).optional(),
});

// -------- superficie del comensal (pública / JWT) --------

// Nunca acepta tenant/branch/table/price — sólo el token del QR y un nombre.
const startSessionPublic = z.object({
  qrToken: z.string().trim().min(20).max(64),
  displayName: z.string().trim().min(1).max(60).optional(),
  nickname: z.string().trim().max(60).optional(),
  seatNo: z.coerce.number().int().min(1).max(50).optional(),
  turnstileToken: z.string().trim().max(4096).optional(),
  // true = "sí, ya estaba anotado con este nombre, soy yo" — confirmado
  // por la persona después de ver el aviso de nombre repetido (ver
  // NAME_TAKEN en tables.service.js). Sin esto, un nombre repetido en la
  // misma mesa rechaza en vez de sumar un duplicado silencioso.
  claim: z.boolean().optional(),
});

// Un comensal ya en la sesión suma a otra persona (mismo dispositivo, p. ej.).
const addParticipant = z.object({
  displayName: z.string().trim().min(1).max(60),
  nickname: z.string().trim().max(60).optional(),
  seatNo: z.coerce.number().int().min(1).max(50).optional(),
});

const setOrderMode = z.object({
  orderMode: z.enum(['INDIVIDUAL', 'GROUP']),
});

module.exports = {
  createTable, updateTable, openSession, assignWaiter, closeSession,
  startSessionPublic, addParticipant, setOrderMode,
};
