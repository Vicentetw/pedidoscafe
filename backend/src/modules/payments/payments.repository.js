const { ulid } = require('ulid');
const pool = require('../../db');

// Repo de payments / allocations / transactions / refunds / webhook events.
// tenantId primero; todo WHERE lo lleva.

const PAYMENT_COLS = `id, public_id, tenant_id, branch_id, session_id, order_id, kind, provider,
  method_detail, amount, tip_amount, currency, status, status_detail, external_reference,
  provider_ref, cash_session_id, participant_id, created_by, created_at, updated_at`;

async function createPayment(tenantId, d, conn = pool) {
  const publicId = ulid();
  const externalReference = `pay_${publicId}`;
  const [r] = await conn.query(
    `INSERT INTO payments (public_id, tenant_id, branch_id, session_id, order_id, kind, provider,
        amount, tip_amount, currency, status, external_reference, cash_session_id, participant_id, created_by)
     VALUES (:publicId, :tenantId, :branchId, :sessionId, :orderId, :kind, :provider,
        :amount, :tipAmount, :currency, :status, :externalReference, :cashSessionId, :participantId, :createdBy)`,
    {
      publicId, tenantId, branchId: d.branchId, sessionId: d.sessionId ?? null, orderId: d.orderId ?? null,
      kind: d.kind, provider: d.provider, amount: d.amount, tipAmount: d.tipAmount ?? 0, currency: d.currency ?? 'ARS',
      status: d.status ?? 'CREATED', externalReference, cashSessionId: d.cashSessionId ?? null,
      participantId: d.participantId ?? null, createdBy: d.createdBy ?? null,
    }
  );
  return { id: r.insertId, publicId, externalReference };
}
async function findPayment(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${PAYMENT_COLS} FROM payments WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
  return row || null;
}
async function findPaymentByExternalRef(externalReference, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${PAYMENT_COLS} FROM payments WHERE external_reference = :externalReference`, { externalReference });
  return row || null;
}
async function findPaymentByProviderRef(providerRef, conn = pool) {
  const [[row]] = await conn.query(`SELECT ${PAYMENT_COLS} FROM payments WHERE provider_ref = :providerRef`, { providerRef });
  return row || null;
}
async function lockPayment(tenantId, id, conn) {
  const [[row]] = await conn.query(`SELECT ${PAYMENT_COLS} FROM payments WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`, { tenantId, id });
  return row || null;
}
// `from`/`to` filtran por created_at (fecha o datetime, inclusive de los
// dos extremos) — con esto alcanza para "los pagos de hoy" o de un rango.
// `limit`/`offset` paginan: con cientos de pagos por día, un LIMIT fijo sin
// offset se quedaba corto y sin forma de ver el resto (encontrado en la
// ronda de aceptación real con el usuario).
function paymentsWhere({ sessionId, orderId, branchId, status, from, to }) {
  const where = ['tenant_id = :tenantId'];
  const p = {};
  if (sessionId) { where.push('session_id = :sessionId'); p.sessionId = sessionId; }
  if (orderId) { where.push('order_id = :orderId'); p.orderId = orderId; }
  if (branchId) { where.push('branch_id = :branchId'); p.branchId = branchId; }
  if (status) { where.push('status = :status'); p.status = status; }
  if (from) { where.push('created_at >= :from'); p.from = from; }
  if (to) { where.push('created_at <= :to'); p.to = to; }
  return { where, p };
}
async function listPayments(tenantId, filters = {}, conn = pool) {
  const { limit = 50, offset = 0 } = filters;
  const { where, p } = paymentsWhere(filters);
  p.tenantId = tenantId;
  p.limit = Number(limit);
  p.offset = Number(offset);
  const [rows] = await conn.query(
    `SELECT ${PAYMENT_COLS} FROM payments WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT :limit OFFSET :offset`,
    p
  );
  return rows;
}
async function countPayments(tenantId, filters = {}, conn = pool) {
  const { where, p } = paymentsWhere(filters);
  p.tenantId = tenantId;
  const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM payments WHERE ${where.join(' AND ')}`, p);
  return row.n;
}
async function setPaymentStatus(tenantId, id, status, { statusDetail, providerRef } = {}, conn = pool) {
  const f = ['status = :status'];
  const p = { tenantId, id, status };
  if (statusDetail !== undefined) { f.push('status_detail = :statusDetail'); p.statusDetail = statusDetail; }
  if (providerRef !== undefined) { f.push('provider_ref = :providerRef'); p.providerRef = providerRef; }
  await conn.query(`UPDATE payments SET ${f.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, p);
}

async function addAllocation(tenantId, paymentId, d, conn = pool) {
  await conn.query(
    `INSERT INTO payment_allocations (tenant_id, payment_id, order_id, order_item_id, participant_id, amount)
     VALUES (:tenantId, :paymentId, :orderId, :orderItemId, :participantId, :amount)`,
    { tenantId, paymentId, orderId: d.orderId ?? null, orderItemId: d.orderItemId ?? null, participantId: d.participantId ?? null, amount: d.amount }
  );
}
async function listAllocations(tenantId, paymentId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT order_id, order_item_id, participant_id, amount FROM payment_allocations WHERE tenant_id = :tenantId AND payment_id = :paymentId`,
    { tenantId, paymentId }
  );
  return rows;
}
// Suma pagada por participante (sólo pagos APPROVED/SETTLED/PARTIALLY_REFUNDED).
async function paidByParticipant(tenantId, sessionId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT pa.participant_id, SUM(pa.amount) AS paid
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
      WHERE p.tenant_id = :tenantId AND p.session_id = :sessionId
        AND p.status IN ('APPROVED','SETTLED','PARTIALLY_REFUNDED') AND pa.participant_id IS NOT NULL
      GROUP BY pa.participant_id`,
    { tenantId, sessionId }
  );
  return new Map(rows.map((r) => [r.participant_id, Number(r.paid)]));
}

async function addTransaction(tenantId, paymentId, d, conn = pool) {
  await conn.query(
    `INSERT INTO payment_transactions (tenant_id, payment_id, type, provider_txn_id, amount, status, raw_json)
     VALUES (:tenantId, :paymentId, :type, :providerTxnId, :amount, :status, CAST(:raw AS JSON))`,
    { tenantId, paymentId, type: d.type, providerTxnId: d.providerTxnId ?? null, amount: d.amount, status: d.status ?? null, raw: JSON.stringify(d.raw ?? null) }
  );
}
async function listTransactions(tenantId, paymentId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT type, provider_txn_id, amount, status, created_at FROM payment_transactions
      WHERE tenant_id = :tenantId AND payment_id = :paymentId ORDER BY created_at`,
    { tenantId, paymentId }
  );
  return rows;
}

// -------- webhook idempotency
async function findWebhookEvent(mpNotificationId, conn = pool) {
  const [[row]] = await conn.query(`SELECT id, processed_at FROM mp_webhook_events WHERE mp_notification_id = :id`, { id: mpNotificationId });
  return row || null;
}
async function insertWebhookEvent(mpNotificationId, { topic, resourceId, signatureOk, payload }, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO mp_webhook_events (mp_notification_id, topic, resource_id, signature_ok, payload_json)
     VALUES (:id, :topic, :resourceId, :signatureOk, CAST(:payload AS JSON))`,
    { id: mpNotificationId, topic: topic ?? null, resourceId: resourceId ?? null, signatureOk: signatureOk ? 1 : 0, payload: JSON.stringify(payload ?? null) }
  );
  return r.insertId;
}
async function markWebhookProcessed(id, conn = pool) {
  await conn.query(`UPDATE mp_webhook_events SET processed_at = CURRENT_TIMESTAMP(3) WHERE id = :id`, { id });
}

// -------- refunds
async function createRefund(tenantId, paymentId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO refunds (tenant_id, payment_id, amount, reason, status, provider_ref, created_by)
     VALUES (:tenantId, :paymentId, :amount, :reason, :status, :providerRef, :createdBy)`,
    { tenantId, paymentId, amount: d.amount, reason: d.reason ?? null, status: d.status ?? 'APPROVED', providerRef: d.providerRef ?? null, createdBy: d.createdBy ?? null }
  );
  return r.insertId;
}
async function sumRefunded(tenantId, paymentId, conn = pool) {
  const [[{ s }]] = await conn.query(
    `SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE tenant_id = :tenantId AND payment_id = :paymentId AND status = 'APPROVED'`,
    { tenantId, paymentId }
  );
  return Number(s);
}

module.exports = {
  createPayment, findPayment, findPaymentByExternalRef, findPaymentByProviderRef, lockPayment, listPayments, countPayments, setPaymentStatus,
  addAllocation, listAllocations, paidByParticipant,
  addTransaction, listTransactions,
  findWebhookEvent, insertWebhookEvent, markWebhookProcessed,
  createRefund, sumRefunded,
};
