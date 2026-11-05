// Falla 3 — webhook de MercadoPago: transiciones del MISMO pago
// (in_process -> approved), reintento cuando el proceso falla, y carrera
// webhook vs. "Verificar pago". `fetchPaymentStatus` /
// `findPaymentByExternalReference` se monkeypatchean (sin red).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../src/db');
const { config } = require('../src/config');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const payRepo = require('../src/modules/payments/payments.repository');
const paySvc = require('../src/modules/payments/payments.service');
const mpProvider = require('../src/modules/payments/providers/mercadopago.provider');
const { DomainError } = require('../src/errors');

const T = 998930;
const SECRET = config.mercadopago.webhookSecret;
const IDS = ['mp-tr-1', 'mp-tr-2', 'mp-tr-3'];
let srv;
let ctx = {};
let origFetch;
let origFind;

function headersFor(dataId) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const xRequestId = `req-${Math.random().toString(36).slice(2)}`;
  const v1 = crypto.createHmac('sha256', SECRET).update(`id:${dataId};request-id:${xRequestId};ts:${ts};`).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': xRequestId };
}
function post(dataId, type = 'payment') {
  return fetch(`${srv.baseUrl}/webhooks/mercadopago?data.id=${dataId}&type=${type}`, {
    method: 'POST', headers: { ...headersFor(dataId), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'payment.updated' }),
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanupWebhookEvents() {
  await db.query("DELETE FROM mp_webhook_events WHERE resource_id IN (?, ?, ?)", IDS);
}
async function newSession(code) {
  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, code]);
  const [ts] = await db.query(
    "INSERT INTO table_sessions (public_id, tenant_id, branch_id, table_id, status, total_amount, paid_amount) VALUES (?, ?, ?, ?, 'BILL_REQUESTED', 5000.00, 0.00)",
    [`01MPTRANSITION${code}`.padEnd(26, 'A'), T, ctx.branchId, tb.insertId]
  );
  return ts.insertId;
}
async function newPendingPayment(sessionId, providerRef) {
  const { id, externalReference } = await payRepo.createPayment(T, {
    branchId: ctx.branchId, sessionId, kind: 'SESSION_GROUP', provider: 'MERCADOPAGO', amount: '5000.00', currency: 'ARS',
  });
  await payRepo.setPaymentStatus(T, id, 'PENDING', providerRef ? { providerRef } : {});
  return { id, externalReference };
}

before(async () => {
  if (!SECRET) throw new Error('Falta MP_WEBHOOK_SECRET para este test.');
  srv = await startTestServer();
  await resetTenant(T);
  await cleanupWebhookEvents();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'MP transiciones', 'mp-transiciones-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  origFetch = mpProvider.fetchPaymentStatus;
  origFind = mpProvider.findPaymentByExternalReference;
});

after(async () => {
  mpProvider.fetchPaymentStatus = origFetch;
  mpProvider.findPaymentByExternalReference = origFind;
  await resetTenant(T);
  await cleanupWebhookEvents();
  await srv.close();
  await db.end().catch(() => {});
});

test('in_process y después approved para el MISMO pago: la aprobación se aplica', async () => {
  const sessionId = await newSession('T1');
  const { id, externalReference } = await newPendingPayment(sessionId, 'mp-tr-1');

  mpProvider.fetchPaymentStatus = async (dataId) => ({ id: dataId, status: 'in_process', statusDetail: 'pending_review', externalReference });
  assert.equal((await post('mp-tr-1')).status, 200);
  const [[p1]] = await db.query('SELECT status FROM payments WHERE id = ?', [id]);
  assert.equal(p1.status, 'PENDING');

  mpProvider.fetchPaymentStatus = async (dataId) => ({ id: dataId, status: 'approved', statusDetail: 'accredited', externalReference });
  assert.equal((await post('mp-tr-1')).status, 200);
  const [[p2]] = await db.query('SELECT status FROM payments WHERE id = ?', [id]);
  assert.equal(p2.status, 'APPROVED', 'la segunda notificación (approved) no puede tomarse como duplicada');
  const [[s]] = await db.query('SELECT paid_amount, status FROM table_sessions WHERE id = ?', [sessionId]);
  assert.equal(s.paid_amount, '5000.00');

  // y la misma approved repetida sigue sin duplicar nada
  assert.equal((await post('mp-tr-1')).status, 200);
  const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM payment_transactions WHERE payment_id = ? AND type = 'CAPTURE'", [id]);
  assert.equal(n, 1);
});

test('si procesar falla, el webhook NO responde 200 (MercadoPago reintenta) y el reintento aplica', async () => {
  const sessionId = await newSession('T2');
  const { id, externalReference } = await newPendingPayment(sessionId, 'mp-tr-2');

  mpProvider.fetchPaymentStatus = async () => { throw new Error('MercadoPago no responde'); };
  const res = await post('mp-tr-2');
  assert.notEqual(res.status, 200, 'un error transitorio tiene que dejar que MercadoPago reintente');

  mpProvider.fetchPaymentStatus = async (dataId) => ({ id: dataId, status: 'approved', statusDetail: 'accredited', externalReference });
  assert.equal((await post('mp-tr-2')).status, 200);
  const [[p]] = await db.query('SELECT status FROM payments WHERE id = ?', [id]);
  assert.equal(p.status, 'APPROVED');
});

test('webhook y "Verificar pago" a la vez: se acredita una sola vez', async () => {
  const sessionId = await newSession('T3');
  const { id, externalReference } = await newPendingPayment(sessionId, 'mp-tr-3');
  const real = { id: 'mp-tr-3', status: 'approved', statusDetail: 'accredited', externalReference };
  mpProvider.fetchPaymentStatus = async () => { await sleep(400); return real; };
  mpProvider.findPaymentByExternalReference = async () => { await sleep(150); return real; };

  const [res] = await Promise.all([
    post('mp-tr-3'),
    paySvc.checkPendingMpPayment(T, id, { actorId: null }),
  ]);
  assert.equal(res.status, 200);

  const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM payment_transactions WHERE payment_id = ? AND type = 'CAPTURE'", [id]);
  assert.equal(n, 1, 'una sola captura');
  const [[{ r }]] = await db.query('SELECT COUNT(*) r FROM refunds WHERE tenant_id = ? AND payment_id = ?', [T, id]);
  assert.equal(r, 0, 'no puede quedar una devolución falsa por "pago duplicado"');
  const [[s]] = await db.query('SELECT paid_amount FROM table_sessions WHERE id = ?', [sessionId]);
  assert.equal(s.paid_amount, '5000.00');
});

test('aviso que no es de un pago (merchant_order): 200 sin consultar a MercadoPago', async () => {
  let called = false;
  mpProvider.fetchPaymentStatus = async () => { called = true; throw new Error('no debería llamarse'); };
  const res = await post('mp-tr-order', 'merchant_order');
  assert.equal(res.status, 200);
  assert.equal(called, false);
});

test('MercadoPago no conoce el pago (404, aviso de prueba): 200, sin reintentos inútiles', async () => {
  mpProvider.fetchPaymentStatus = async () => {
    throw new DomainError('No se pudo confirmar el pago con MercadoPago.', { status: 502, code: 'MP_FETCH_FAILED', details: { httpStatus: 404 } });
  };
  const res = await post('mp-tr-404');
  assert.equal(res.status, 200);
});
