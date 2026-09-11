const pool = require('../../db');

// Repo dispositivos: alta/estado, asignación a pedidos, notificaciones.
// tenantId primero; todo WHERE lo lleva.

async function createDevice(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO devices (tenant_id, branch_id, code, kind) VALUES (:tenantId, :branchId, :code, :kind)`,
    { tenantId, branchId: d.branchId, code: d.code, kind: d.kind ?? 'BUZZER' }
  );
  return r.insertId;
}
async function listDevices(tenantId, { branchId = null } = {}, conn = pool) {
  const where = ['tenant_id = :tenantId'];
  const params = { tenantId };
  if (branchId) { where.push('branch_id = :branchId'); params.branchId = branchId; }
  const [rows] = await conn.query(
    `SELECT id, branch_id, code, kind, status, last_seen_at FROM devices WHERE ${where.join(' AND ')} ORDER BY code`, params
  );
  return rows;
}
async function findDevice(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(`SELECT id, tenant_id, branch_id, code, kind, status FROM devices WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  return row || null;
}
async function findByCode(tenantId, branchId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, branch_id, code, kind, status FROM devices WHERE tenant_id = :tenantId AND branch_id = :branchId AND code = :code`,
    { tenantId, branchId, code }
  );
  return row || null;
}
async function lockByCode(tenantId, branchId, code, conn) {
  const [[row]] = await conn.query(
    `SELECT id, status FROM devices WHERE tenant_id = :tenantId AND branch_id = :branchId AND code = :code FOR UPDATE`,
    { tenantId, branchId, code }
  );
  return row || null;
}
async function setStatus(tenantId, id, status, conn = pool) {
  await conn.query(`UPDATE devices SET status = :status WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, status });
}

// -------- asignación
async function createAssignment(tenantId, deviceId, orderId, conn) {
  const [r] = await conn.query(
    `INSERT INTO device_assignments (tenant_id, device_id, order_id) VALUES (:tenantId, :deviceId, :orderId)`,
    { tenantId, deviceId, orderId }
  );
  return r.insertId;
}
async function findActiveAssignmentForOrder(tenantId, orderId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT da.id, da.device_id, d.code, d.branch_id FROM device_assignments da JOIN devices d ON d.id = da.device_id
      WHERE da.tenant_id = :tenantId AND da.order_id = :orderId AND da.released_at IS NULL`,
    { tenantId, orderId }
  );
  return row || null;
}
async function releaseAssignment(tenantId, assignmentId, conn) {
  await conn.query(`UPDATE device_assignments SET released_at = NOW() WHERE tenant_id = :tenantId AND id = :assignmentId`, { tenantId, assignmentId });
}

// -------- notificaciones (log de avisos — no es un canal más a configurar
// en esta fase, sólo el registro de lo que se intentó avisar)
async function createNotification(tenantId, d, conn = pool) {
  const sentAtSql = d.status === 'FAILED' ? 'NULL' : 'CURRENT_TIMESTAMP';
  const [r] = await conn.query(
    `INSERT INTO notifications (tenant_id, branch_id, target_kind, target_ref, channel, template, payload, status, sent_at)
     VALUES (:tenantId, :branchId, :targetKind, :targetRef, :channel, :template, :payload, :status, ${sentAtSql})`,
    {
      tenantId, branchId: d.branchId ?? null, targetKind: d.targetKind, targetRef: d.targetRef, channel: d.channel,
      template: d.template, payload: d.payload ? JSON.stringify(d.payload) : null, status: d.status ?? 'SENT',
    }
  );
  return r.insertId;
}

module.exports = {
  createDevice, listDevices, findDevice, findByCode, lockByCode, setStatus,
  createAssignment, findActiveAssignmentForOrder, releaseAssignment,
  createNotification,
};
