const pool = require('../../db');

// Repo fidelización: cuentas, ledger, niveles, regla. tenantId primero;
// todo WHERE lo lleva.

async function findAccountByCustomer(tenantId, customerId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, customer_id, points_balance, tier_id, updated_at FROM loyalty_accounts WHERE tenant_id = :tenantId AND customer_id = :customerId`,
    { tenantId, customerId }
  );
  return row || null;
}
async function lockOrCreateAccount(tenantId, customerId, conn) {
  await conn.query(
    `INSERT INTO loyalty_accounts (tenant_id, customer_id) VALUES (:tenantId, :customerId)
     ON DUPLICATE KEY UPDATE tenant_id = tenant_id`, // no-op si ya existe; sólo garantiza la fila
    { tenantId, customerId }
  );
  const [[row]] = await conn.query(
    `SELECT id, points_balance, tier_id FROM loyalty_accounts WHERE tenant_id = :tenantId AND customer_id = :customerId FOR UPDATE`,
    { tenantId, customerId }
  );
  return row;
}
async function addLedgerEntry(tenantId, accountId, d, conn) {
  const [r] = await conn.query(
    `INSERT INTO loyalty_transactions (tenant_id, account_id, type, points, ref_type, ref_id, reason, actor_kind, actor_id)
     VALUES (:tenantId, :accountId, :type, :points, :refType, :refId, :reason, :actorKind, :actorId)`,
    {
      tenantId, accountId, type: d.type, points: d.points, refType: d.refType ?? null, refId: d.refId ?? null,
      reason: d.reason ?? null, actorKind: d.actorKind ?? null, actorId: d.actorId ?? null,
    }
  );
  return r.insertId;
}
async function updateBalance(tenantId, accountId, newBalance, tierId, conn) {
  await conn.query(
    `UPDATE loyalty_accounts SET points_balance = :balance, tier_id = :tierId WHERE tenant_id = :tenantId AND id = :accountId`,
    { tenantId, accountId, balance: newBalance, tierId: tierId ?? null }
  );
}
async function listTransactions(tenantId, accountId, { limit = 50 } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, type, points, ref_type, ref_id, reason, actor_kind, created_at
       FROM loyalty_transactions WHERE tenant_id = :tenantId AND account_id = :accountId
      ORDER BY created_at DESC, id DESC LIMIT :limit`,
    { tenantId, accountId, limit: Number(limit) }
  );
  return rows;
}

// -------- niveles
async function listTiers(tenantId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, code, name, min_points, multiplier, benefits FROM loyalty_tiers WHERE tenant_id = :tenantId ORDER BY min_points`,
    { tenantId }
  );
  return rows;
}
async function createTier(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO loyalty_tiers (tenant_id, code, name, min_points, multiplier, benefits) VALUES (:tenantId, :code, :name, :minPoints, :multiplier, :benefits)`,
    { tenantId, code: d.code, name: d.name, minPoints: d.minPoints, multiplier: d.multiplier ?? 1, benefits: d.benefits ? JSON.stringify(d.benefits) : null }
  );
  return r.insertId;
}
// El nivel más alto cuyo mínimo no supera el balance — mismo criterio que
// una escala de tramos, sin superponerse.
async function resolveTier(tenantId, points, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, code, name, multiplier FROM loyalty_tiers WHERE tenant_id = :tenantId AND min_points <= :points ORDER BY min_points DESC LIMIT 1`,
    { tenantId, points }
  );
  return row || null;
}

// -------- regla de acumulación
async function getActiveRule(tenantId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, scope, points_per_amount, active FROM loyalty_rules WHERE tenant_id = :tenantId AND active = 1 ORDER BY id LIMIT 1`,
    { tenantId }
  );
  return row || null;
}
async function listRules(tenantId, conn = pool) {
  const [rows] = await conn.query(`SELECT id, scope, points_per_amount, active FROM loyalty_rules WHERE tenant_id = :tenantId ORDER BY id`, { tenantId });
  return rows;
}
async function createRule(tenantId, d, conn = pool) {
  if (d.active) await conn.query(`UPDATE loyalty_rules SET active = 0 WHERE tenant_id = :tenantId`, { tenantId }); // una sola activa a la vez (igual que is_default en tax_rates)
  const [r] = await conn.query(
    `INSERT INTO loyalty_rules (tenant_id, scope, points_per_amount, active) VALUES (:tenantId, :scope, :pointsPerAmount, :active)`,
    { tenantId, scope: d.scope ?? 'GLOBAL', pointsPerAmount: d.pointsPerAmount, active: d.active === false ? 0 : 1 }
  );
  return r.insertId;
}

module.exports = {
  findAccountByCustomer, lockOrCreateAccount, addLedgerEntry, updateBalance, listTransactions,
  listTiers, createTier, resolveTier, getActiveRule, listRules, createRule,
};
