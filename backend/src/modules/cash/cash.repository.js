const pool = require('../../db');

// Repo de cajas físicas / sesiones de caja / movimientos. tenantId primero;
// todo WHERE lo lleva.

// -------- cajas
async function listRegisters(tenantId, branchId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, code, name FROM cash_registers WHERE tenant_id = :tenantId AND branch_id = :branchId AND deleted_at IS NULL ORDER BY name`,
    { tenantId, branchId }
  );
  return rows;
}
async function findRegister(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, branch_id, code, name FROM cash_registers WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return row || null;
}
async function findRegisterByCode(tenantId, branchId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM cash_registers WHERE tenant_id = :tenantId AND branch_id = :branchId AND code = :code AND deleted_at IS NULL`,
    { tenantId, branchId, code }
  );
  return row || null;
}
async function createRegister(tenantId, branchId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO cash_registers (tenant_id, branch_id, code, name) VALUES (:tenantId, :branchId, :code, :name)`,
    { tenantId, branchId, code: d.code, name: d.name }
  );
  return r.insertId;
}

// -------- sesiones de caja
const SESSION_COLS = `id, tenant_id, branch_id, register_id, status, opened_by, opening_amount, opened_at,
  closed_by, closing_amount, expected_amount, difference, closed_at`;

async function findOpenSessionByRegister(tenantId, registerId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT ${SESSION_COLS} FROM cash_sessions WHERE tenant_id = :tenantId AND active_register_id = :registerId`,
    { tenantId, registerId }
  );
  return row || null;
}
async function findSession(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${SESSION_COLS} FROM cash_sessions WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  return row || null;
}
async function lockSession(tenantId, id, conn) {
  const [[row]] = await conn.query(`SELECT ${SESSION_COLS} FROM cash_sessions WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`, { tenantId, id });
  return row || null;
}
async function listOpenSessions(tenantId, branchId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT s.id, s.register_id, s.status, s.opened_by, s.opening_amount, s.opened_at,
            r.code AS register_code, r.name AS register_name
       FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
      WHERE s.tenant_id = :tenantId AND s.branch_id = :branchId AND s.status = 'OPEN'
      ORDER BY s.opened_at`,
    { tenantId, branchId }
  );
  return rows;
}
async function createSession(tenantId, branchId, registerId, openingAmount, openedBy, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO cash_sessions (tenant_id, branch_id, register_id, status, opening_amount, opened_by)
     VALUES (:tenantId, :branchId, :registerId, 'OPEN', :openingAmount, :openedBy)`,
    { tenantId, branchId, registerId, openingAmount, openedBy: openedBy ?? null }
  );
  return r.insertId;
}
async function closeSession(tenantId, id, { closingAmount, expectedAmount, difference, closedBy }, conn = pool) {
  await conn.query(
    `UPDATE cash_sessions SET status = 'CLOSED', closing_amount = :closingAmount, expected_amount = :expectedAmount,
        difference = :difference, closed_by = :closedBy, closed_at = CURRENT_TIMESTAMP
      WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id, closingAmount, expectedAmount, difference, closedBy: closedBy ?? null }
  );
}

// -------- movimientos
async function addMovement(tenantId, branchId, cashSessionId, d, conn = pool) {
  await conn.query(
    `INSERT INTO cash_movements (tenant_id, branch_id, cash_session_id, type, amount, payment_id, reason, actor_user_id)
     VALUES (:tenantId, :branchId, :cashSessionId, :type, :amount, :paymentId, :reason, :actorUserId)`,
    { tenantId, branchId, cashSessionId, type: d.type, amount: d.amount, paymentId: d.paymentId ?? null, reason: d.reason ?? null, actorUserId: d.actorUserId ?? null }
  );
}
async function listMovements(tenantId, cashSessionId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT type, amount, payment_id, reason, actor_user_id, created_at FROM cash_movements
      WHERE tenant_id = :tenantId AND cash_session_id = :cashSessionId ORDER BY created_at`,
    { tenantId, cashSessionId }
  );
  return rows;
}
async function sumMovements(tenantId, cashSessionId, conn = pool) {
  const [[{ s }]] = await conn.query(
    `SELECT COALESCE(SUM(amount),0) s FROM cash_movements WHERE tenant_id = :tenantId AND cash_session_id = :cashSessionId`,
    { tenantId, cashSessionId }
  );
  return Number(s);
}

module.exports = {
  listRegisters, findRegister, findRegisterByCode, createRegister,
  findOpenSessionByRegister, findSession, lockSession, listOpenSessions, createSession, closeSession,
  addMovement, listMovements, sumMovements,
};
