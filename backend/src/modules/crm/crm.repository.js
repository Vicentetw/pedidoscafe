const pool = require('../../db');

// Repo CRM: clientes, preferencias, vínculo con participantes/pedidos.
// tenantId primero; todo WHERE lo lleva.

const CUSTOMER_COLS = `id, tenant_id, code, name, phone, email, birth_date, home_branch_id,
  consent, notes, first_seen_at, last_order_at, created_at, updated_at`;

async function createCustomer(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO customers (tenant_id, code, name, phone, email, birth_date, home_branch_id, consent, notes)
     VALUES (:tenantId, :code, :name, :phone, :email, :birthDate, :homeBranchId, :consent, :notes)`,
    {
      tenantId, code: d.code ?? null, name: d.name, phone: d.phone ?? null, email: d.email ?? null,
      birthDate: d.birthDate ?? null, homeBranchId: d.homeBranchId ?? null,
      consent: d.consent ? JSON.stringify(d.consent) : null, notes: d.notes ?? null,
    }
  );
  return r.insertId;
}
async function updateCustomer(tenantId, id, d, conn = pool) {
  const fields = { code: 'code', name: 'name', phone: 'phone', email: 'email', birthDate: 'birth_date', homeBranchId: 'home_branch_id', notes: 'notes' };
  const sets = [];
  const params = { tenantId, id };
  for (const [k, col] of Object.entries(fields)) {
    if (d[k] !== undefined) { sets.push(`${col} = :${k}`); params[k] = d[k]; }
  }
  if (d.consent !== undefined) { sets.push(`consent = :consent`); params.consent = d.consent ? JSON.stringify(d.consent) : null; }
  if (!sets.length) return;
  await conn.query(`UPDATE customers SET ${sets.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, params);
}
async function findCustomer(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${CUSTOMER_COLS} FROM customers WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  return row || null;
}
async function findByPhoneOrEmail(tenantId, { phone, email }, conn = pool) {
  if (!phone && !email) return null;
  const [rows] = await conn.query(
    `SELECT ${CUSTOMER_COLS} FROM customers WHERE tenant_id = :tenantId AND ((phone IS NOT NULL AND phone = :phone) OR (email IS NOT NULL AND email = :email)) LIMIT 1`,
    { tenantId, phone: phone ?? null, email: email ?? null }
  );
  return rows[0] || null;
}
async function listCustomers(tenantId, { search = null, limit = 100 } = {}, conn = pool) {
  const where = ['tenant_id = :tenantId'];
  const params = { tenantId, limit: Number(limit) };
  if (search) {
    where.push('(name LIKE :search OR phone LIKE :search OR email LIKE :search OR code LIKE :search)');
    params.search = `%${search}%`;
  }
  const [rows] = await conn.query(
    `SELECT ${CUSTOMER_COLS} FROM customers WHERE ${where.join(' AND ')} ORDER BY name LIMIT :limit`, params
  );
  return rows;
}
async function touchLastOrder(tenantId, customerId, conn = pool) {
  await conn.query(`UPDATE customers SET last_order_at = NOW() WHERE tenant_id = :tenantId AND id = :customerId`, { tenantId, customerId });
}

// -------- preferencias
async function setPreference(tenantId, customerId, key, value, conn = pool) {
  await conn.query(
    `INSERT INTO customer_preferences (customer_id, tenant_id, \`key\`, value) VALUES (:customerId, :tenantId, :key, :value)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    { tenantId, customerId, key, value }
  );
}
async function listPreferences(tenantId, customerId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT \`key\`, value, updated_at FROM customer_preferences WHERE tenant_id = :tenantId AND customer_id = :customerId ORDER BY \`key\``,
    { tenantId, customerId }
  );
  return rows;
}

// -------- vínculo
async function linkParticipant(tenantId, participantId, customerId, conn = pool) {
  const [r] = await conn.query(
    `UPDATE session_participants SET customer_id = :customerId WHERE tenant_id = :tenantId AND id = :participantId`,
    { tenantId, participantId, customerId }
  );
  return r.affectedRows > 0;
}

// Historial: pedidos vinculados directo (mostrador) + los de mesa donde el
// participante quedó linkeado a este cliente (aunque el pedido en sí no
// tenga customer_id propio).
async function listOrdersForCustomer(tenantId, customerId, { limit = 50 } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT DISTINCT o.id, o.public_id, o.branch_id, o.channel, o.status, o.payment_status, o.total, o.currency, o.created_at
       FROM orders o
       LEFT JOIN session_participants sp ON sp.id = o.participant_id AND sp.tenant_id = o.tenant_id
      WHERE o.tenant_id = :tenantId AND (o.customer_id = :customerId OR sp.customer_id = :customerId)
      ORDER BY o.created_at DESC LIMIT :limit`,
    { tenantId, customerId, limit: Number(limit) }
  );
  return rows;
}

module.exports = {
  createCustomer, updateCustomer, findCustomer, findByPhoneOrEmail, listCustomers, touchLastOrder,
  setPreference, listPreferences, linkParticipant, listOrdersForCustomer,
};
