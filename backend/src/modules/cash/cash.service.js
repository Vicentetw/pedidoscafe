const repo = require('./cash.repository');
const branchRepo = require('../platform/branches.repository');
const { toCents, fromCents } = require('../catalog/pricing');
const { withTransaction } = require('../../withTransaction');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');

const actorOf = (req) => req?.appUser?.id ?? null;

async function listRegisters(tenantId, branchId) {
  return repo.listRegisters(tenantId, branchId);
}
async function createRegister(tenantId, branchId, input, req) {
  if (!(await branchRepo.findById(tenantId, branchId))) throw new ValidationError('Esa sucursal no existe.');
  if (await repo.findRegisterByCode(tenantId, branchId, input.code)) throw new ConflictError('Ya existe una caja con ese código en esa sucursal.');
  const id = await repo.createRegister(tenantId, branchId, input);
  await writeAudit({ req, tenantId, branchId, entityType: 'cash_register', entityId: id, action: 'create', after: input });
  return repo.findRegister(tenantId, id);
}

async function openRegister(tenantId, registerId, openingAmount, req) {
  const register = await repo.findRegister(tenantId, registerId);
  if (!register) throw new NotFoundError('Esa caja no existe.');
  if (await repo.findOpenSessionByRegister(tenantId, registerId)) {
    throw new ConflictError('Esa caja ya está abierta.');
  }
  const id = await withTransaction(async (conn) => {
    const existing = await repo.findOpenSessionByRegister(tenantId, registerId, conn);
    if (existing) throw new ConflictError('Esa caja ya está abierta.');
    return repo.createSession(tenantId, register.branch_id, registerId, openingAmount, actorOf(req), conn);
  });
  await writeAudit({ req, tenantId, branchId: register.branch_id, entityType: 'cash_session', entityId: id, action: 'open', after: { openingAmount } });
  return getSession(tenantId, id);
}

async function listOpenSessions(tenantId, branchId) {
  return repo.listOpenSessions(tenantId, branchId);
}
async function getSession(tenantId, id) {
  const s = await repo.findSession(tenantId, id);
  if (!s) throw new NotFoundError('Esa sesión de caja no existe.');
  const movements = await repo.listMovements(tenantId, id);
  const balance = toCents(s.opening_amount) + movements.reduce((a, m) => a + toCents(m.amount), 0);
  return { ...s, movements, currentBalance: fromCents(balance) };
}

async function addMovement(tenantId, sessionId, input, req) {
  const session = await repo.findSession(tenantId, sessionId);
  if (!session) throw new NotFoundError('Esa sesión de caja no existe.');
  if (session.status !== 'OPEN') throw new ConflictError('Esa caja ya está cerrada.');
  // PAYOUT siempre resta, DEPOSIT siempre suma — el signo lo pone el
  // sistema, no quien carga el movimiento. ADJUST sí permite ambos signos
  // (corrección contable puntual).
  const signedCents =
    input.type === 'PAYOUT' ? -Math.abs(toCents(input.amount))
    : input.type === 'DEPOSIT' ? Math.abs(toCents(input.amount))
    : toCents(input.amount);
  await repo.addMovement(tenantId, session.branch_id, sessionId, {
    type: input.type, amount: fromCents(signedCents), reason: input.reason, actorUserId: actorOf(req),
  });
  await writeAudit({ req, tenantId, branchId: session.branch_id, entityType: 'cash_session', entityId: sessionId, action: `movement_${input.type.toLowerCase()}`, after: { amount: fromCents(signedCents), reason: input.reason } });
  return getSession(tenantId, sessionId);
}

async function closeRegisterSession(tenantId, sessionId, closingAmount, req) {
  const result = await withTransaction(async (conn) => {
    const session = await repo.lockSession(tenantId, sessionId, conn);
    if (!session) throw new NotFoundError('Esa sesión de caja no existe.');
    if (session.status !== 'OPEN') throw new ConflictError('Esa caja ya está cerrada.');
    // sumMovements ya devuelve el total en unidades de moneda (no en
    // centavos) — toCents() lo convierte directo, sin volver a pasar por
    // fromCents() (ese doble paso era el bug: dividía por 100 de más).
    const movementsSum = await repo.sumMovements(tenantId, sessionId, conn);
    const expectedCents = toCents(session.opening_amount) + toCents(movementsSum);
    const diffCents = toCents(closingAmount) - expectedCents;
    await repo.closeSession(tenantId, sessionId, {
      closingAmount, expectedAmount: fromCents(expectedCents), difference: fromCents(diffCents), closedBy: actorOf(req),
    }, conn);
    return { branchId: session.branch_id, expected: fromCents(expectedCents), difference: fromCents(diffCents) };
  });
  await writeAudit({
    req, tenantId, branchId: result.branchId, entityType: 'cash_session', entityId: sessionId, action: 'close',
    after: { closingAmount, expected: result.expected, difference: result.difference },
  });
  return getSession(tenantId, sessionId);
}

// -------- llamado desde payments.service cuando una venta/devolución en
// efectivo está vinculada a una caja abierta. Corre DENTRO de la misma
// transacción del pago (recibe `conn`).
async function recordCashMovementForPayment(tenantId, cashSessionId, { type, amount, paymentId, actorUserId }, conn) {
  const session = await repo.lockSession(tenantId, cashSessionId, conn);
  if (!session) throw new NotFoundError('Esa caja no existe.');
  if (session.status !== 'OPEN') throw new ConflictError('La caja elegida ya está cerrada.');
  await repo.addMovement(tenantId, session.branch_id, cashSessionId, { type, amount, paymentId, actorUserId }, conn);
}

module.exports = {
  listRegisters, createRegister, openRegister, listOpenSessions, getSession, addMovement, closeRegisterSession,
  recordCashMovementForPayment,
};
