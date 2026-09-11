// Webhook de MercadoPago — firma, re-consulta del estado real, e
// idempotencia (CASO OBLIGATORIO 3: llega dos veces -> una sola
// transacción). `fetchPaymentStatus` se monkeypatchea para no depender de
// credenciales reales de MercadoPago (no hay en este entorno) — la firma
// SÍ se calcula con la fórmula real, usando el MP_WEBHOOK_SECRET del .env.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../src/db');
const { config } = require('../src/config');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const payRepo = require('../src/modules/payments/payments.repository');
const mpProvider = require('../src/modules/payments/providers/mercadopago.provider');

const T = 998920;
const SECRET = config.mercadopago.webhookSecret;
let srv;
let ctx = {};
let origFetchPaymentStatus;

function sign(dataId, xRequestId, ts) {
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  return crypto.createHmac('sha256', SECRET).update(manifest).digest('hex');
}
function headersFor(dataId, { badSignature = false } = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const xRequestId = `req-${Math.random().toString(36).slice(2)}`;
  const v1 = badSignature ? '0'.repeat(64) : sign(dataId, xRequestId, ts);
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': xRequestId };
}
function post(dataId, headers) {
  return fetch(`${srv.baseUrl}/webhooks/mercadopago?data.id=${dataId}&type=payment`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'payment.updated' }),
  });
}

// mp_webhook_events no tiene tenant_id (una notificación de MercadoPago no
// trae ninguna referencia nuestra hasta que se resuelve) — resetTenant()
// no la toca. Se limpia acá por los ids de notificación que usa ESTE
// archivo, para no arrastrar filas de una corrida anterior.
async function cleanupWebhookEvents() {
  await db.query("DELETE FROM mp_webhook_events WHERE mp_notification_id IN ('payment:mp-does-not-matter', 'payment:mp-pay-1', 'payment:mp-pay-2')");
}

before(async () => {
  if (!SECRET) throw new Error('Falta MP_WEBHOOK_SECRET en el .env para este test.');
  srv = await startTestServer();
  await resetTenant(T);
  await cleanupWebhookEvents();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Webhook MP', 'webhook-mp-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, b.insertId, 'W1']);
  const [ts] = await db.query(
    "INSERT INTO table_sessions (public_id, tenant_id, branch_id, table_id, status, total_amount, paid_amount) VALUES ('01WEBHOOKTESTSESSIONAAAA', ?, ?, ?, 'BILL_REQUESTED', 5000.00, 0.00)",
    [T, b.insertId, tb.insertId]
  );
  ctx.branchId = b.insertId;
  ctx.sessionId = ts.insertId;

  origFetchPaymentStatus = mpProvider.fetchPaymentStatus;
});

after(async () => {
  mpProvider.fetchPaymentStatus = origFetchPaymentStatus;
  await resetTenant(T);
  await cleanupWebhookEvents();
  await srv.close();
  await db.end().catch(() => {});
});

test('firma inválida -> 401, no se procesa nada', async () => {
  const res = await post('mp-does-not-matter', headersFor('mp-does-not-matter', { badSignature: true }));
  assert.equal(res.status, 401);
  const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM mp_webhook_events WHERE mp_notification_id = 'payment:mp-does-not-matter'");
  assert.equal(n, 0);
});

test('firma válida + pago aprobado: aplica al saldo de la mesa', async () => {
  const { id: paymentId, externalReference } = await payRepo.createPayment(T, {
    branchId: ctx.branchId, sessionId: ctx.sessionId, kind: 'SESSION_GROUP', provider: 'MERCADOPAGO', amount: '5000.00', currency: 'ARS',
  });
  await payRepo.setPaymentStatus(T, paymentId, 'PENDING', { providerRef: 'mp-pay-1' });
  ctx.paymentId = paymentId;

  mpProvider.fetchPaymentStatus = async (id) => ({ id, status: 'approved', statusDetail: 'accredited', externalReference, amount: 5000, currency: 'ARS' });

  const res = await post('mp-pay-1', headersFor('mp-pay-1'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).duplicate, false);

  const [[p]] = await db.query('SELECT status FROM payments WHERE id = ?', [paymentId]);
  assert.equal(p.status, 'APPROVED');
  const [[s]] = await db.query('SELECT paid_amount, status FROM table_sessions WHERE id = ?', [ctx.sessionId]);
  assert.equal(s.paid_amount, '5000.00');
  assert.equal(s.status, 'PAID');
});

test('CASO OBLIGATORIO 3: la MISMA notificación llega dos veces -> una sola transacción, sin duplicar', async () => {
  const res2 = await post('mp-pay-1', headersFor('mp-pay-1'));
  assert.equal(res2.status, 200);
  assert.equal((await res2.json()).duplicate, true);

  const [[{ n: events }]] = await db.query('SELECT COUNT(*) n FROM mp_webhook_events WHERE mp_notification_id = ?', ['payment:mp-pay-1']);
  assert.equal(events, 1, 'una sola fila de idempotencia para esta notificación');
  const [[{ n: txns }]] = await db.query("SELECT COUNT(*) n FROM payment_transactions WHERE payment_id = ? AND type = 'CAPTURE'", [ctx.paymentId]);
  assert.equal(txns, 1, 'una sola transacción CAPTURE, no dos');
  const [[s]] = await db.query('SELECT paid_amount FROM table_sessions WHERE id = ?', [ctx.sessionId]);
  assert.equal(s.paid_amount, '5000.00', 'el saldo no se duplicó');
});

test('un segundo pago aprobado sobre una mesa YA saldada no la sobre-cobra: queda una devolución pendiente por el excedente', async () => {
  const { id: paymentId2, externalReference: ref2 } = await payRepo.createPayment(T, {
    branchId: ctx.branchId, sessionId: ctx.sessionId, kind: 'SESSION_GROUP', provider: 'MERCADOPAGO', amount: '5000.00', currency: 'ARS',
  });
  await payRepo.setPaymentStatus(T, paymentId2, 'PENDING', { providerRef: 'mp-pay-2' });

  mpProvider.fetchPaymentStatus = async (id) => ({ id, status: 'approved', statusDetail: 'accredited', externalReference: ref2, amount: 5000, currency: 'ARS' });
  const res = await post('mp-pay-2', headersFor('mp-pay-2'));
  assert.equal(res.status, 200);

  const [[p2]] = await db.query('SELECT status FROM payments WHERE id = ?', [paymentId2]);
  assert.equal(p2.status, 'APPROVED', 'el pago en sí se marca aprobado (el dinero se cobró de verdad)');
  const [[s]] = await db.query('SELECT paid_amount, total_amount FROM table_sessions WHERE id = ?', [ctx.sessionId]);
  assert.equal(s.paid_amount, s.total_amount, 'el saldo de la mesa NUNCA queda por encima del total');
  const [[refund]] = await db.query("SELECT amount, status FROM refunds WHERE tenant_id = ? AND payment_id = ?", [T, paymentId2]);
  assert.equal(refund.amount, '5000.00');
  assert.equal(refund.status, 'PENDING');
});
