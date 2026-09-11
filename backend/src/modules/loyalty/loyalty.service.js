const repo = require('./loyalty.repository');
const crmRepo = require('../crm/crm.repository');
const { withTransaction } = require('../../withTransaction');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');

// Aplica una entrada del ledger dentro de una transacción: lockea (o crea)
// la cuenta, inserta la fila, recalcula balance + nivel. Si `refType`+`refId`
// ya se usaron para este mismo `type` (p.ej. un reintento del mismo pago),
// el UNIQUE del ledger lo detecta y este helper lo trata como no-op
// idempotente en vez de fallar — mismo patrón que los webhooks de MP.
async function applyLedgerEntry(tenantId, customerId, { type, points, refType, refId, reason, actorKind, actorId }, conn) {
  // lockOrCreateAccount haría un INSERT que rebota contra la FK si el
  // cliente no existe (o es de otro tenant) — mejor un 404 con lenguaje
  // humano que dejar pasar el error crudo de MySQL.
  if (!(await crmRepo.findCustomer(tenantId, customerId, conn))) throw new NotFoundError('Ese cliente no existe.');
  const account = await repo.lockOrCreateAccount(tenantId, customerId, conn);
  const nextBalance = account.points_balance + points;
  if (nextBalance < 0) {
    throw new ConflictError('No hay puntos suficientes para esto.', { code: 'INSUFFICIENT_POINTS', details: { balance: account.points_balance } });
  }
  try {
    await repo.addLedgerEntry(tenantId, account.id, { type, points, refType, refId, reason, actorKind, actorId }, conn);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return { account, applied: false }; // ya se había acreditado/descontado antes — no-op
    throw err;
  }
  const tier = await repo.resolveTier(tenantId, nextBalance, conn);
  await repo.updateBalance(tenantId, account.id, nextBalance, tier ? tier.id : null, conn);
  return { account: { ...account, points_balance: nextBalance, tier_id: tier ? tier.id : null }, applied: true };
}

// Ganancia automática al cobrarse un pedido de mostrador con cliente
// identificado (ver payments.service.js). Si no hay regla activa, es un
// no-op silencioso: el sistema sigue cobrando igual, simplemente sin sumar
// puntos (mismo espíritu que "sin AFIP configurado, sigue emitiendo ticket").
async function earnForOrderPayment(tenantId, { customerId, amountCents, orderId }, conn) {
  if (!customerId) return null;
  const rule = await repo.getActiveRule(tenantId, conn);
  if (!rule) return null;
  const account = await repo.findAccountByCustomer(tenantId, customerId, conn);
  const tier = account?.tier_id ? await repo.resolveTier(tenantId, account.points_balance, conn) : null;
  const multiplier = tier ? Number(tier.multiplier) : 1;
  const amount = amountCents / 100;
  const earned = Math.floor(amount * Number(rule.points_per_amount) * multiplier);
  if (earned <= 0) return null;
  return applyLedgerEntry(tenantId, customerId, {
    type: 'EARN', points: earned, refType: 'ORDER_PAYMENT', refId: orderId, reason: 'Compra en mostrador', actorKind: 'system',
  }, conn);
}

async function getAccount(tenantId, customerId) {
  const customer = await crmRepo.findCustomer(tenantId, customerId);
  if (!customer) throw new NotFoundError('Ese cliente no existe.');
  const account = await repo.findAccountByCustomer(tenantId, customerId);
  if (!account) return { tenant_id: tenantId, customer_id: customerId, points_balance: 0, tier_id: null, tier: null };
  const tier = account.tier_id ? await repo.resolveTier(tenantId, account.points_balance) : null;
  return { ...account, tier };
}
async function listTransactions(tenantId, customerId) {
  const account = await repo.findAccountByCustomer(tenantId, customerId);
  if (!account) return [];
  return repo.listTransactions(tenantId, account.id);
}

async function manualEarn(tenantId, customerId, { points, reason }, actor) {
  const result = await withTransaction((conn) =>
    applyLedgerEntry(tenantId, customerId, { type: 'EARN', points, reason, actorKind: 'staff', actorId: actor.actorId ?? null }, conn));
  await writeAudit({ req: actor.req, tenantId, entityType: 'loyalty_account', entityId: customerId, action: 'earn', after: { points, reason } });
  return getAccount(tenantId, customerId);
}
async function redeem(tenantId, customerId, { points, reason }, actor) {
  await withTransaction((conn) =>
    applyLedgerEntry(tenantId, customerId, { type: 'REDEEM', points: -points, reason, actorKind: 'staff', actorId: actor.actorId ?? null }, conn));
  await writeAudit({ req: actor.req, tenantId, entityType: 'loyalty_account', entityId: customerId, action: 'redeem', after: { points, reason } });
  return getAccount(tenantId, customerId);
}
async function adjust(tenantId, customerId, { points, reason }, actor) {
  await withTransaction((conn) =>
    applyLedgerEntry(tenantId, customerId, { type: 'ADJUST', points, reason, actorKind: 'staff', actorId: actor.actorId ?? null }, conn));
  await writeAudit({ req: actor.req, tenantId, entityType: 'loyalty_account', entityId: customerId, action: 'adjust', after: { points, reason } });
  return getAccount(tenantId, customerId);
}

// -------- niveles y regla
async function listTiers(tenantId) { return repo.listTiers(tenantId); }
async function createTier(tenantId, input, req) {
  const id = await repo.createTier(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'loyalty_tier', entityId: id, action: 'create', after: input });
  return id;
}
async function getActiveRule(tenantId) { return repo.getActiveRule(tenantId); }
async function listRules(tenantId) { return repo.listRules(tenantId); }
async function createRule(tenantId, input, req) {
  const id = await repo.createRule(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'loyalty_rule', entityId: id, action: 'create', after: input });
  return id;
}

module.exports = {
  earnForOrderPayment, getAccount, listTransactions, manualEarn, redeem, adjust,
  listTiers, createTier, getActiveRule, listRules, createRule,
};
