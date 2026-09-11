// Gating de permisos de pagos por HTTP con ID token real de Firebase.
// mozo no tiene payments:*; cajero sí (view/charge/refund).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998940;
const UID_CAJA = 'test-pay-cajero';
const UID_MOZO = 'test-pay-mozo';
let srv;
let cajaH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Pagos admin', 'pagos-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '4000.00']);
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, b.insertId, 'M1']);
  const qr = await tablesRepo.createQrToken(T, b.insertId, t.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: 'X' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  ctx.sessionId = sess.id;
  const o = await orderSvc.createOrder(T, { branchId: b.insertId, sessionId: sess.id, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, { kind: 'guest' });
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });

  cajaH = await getTestAuthHeaders(UID_CAJA, { isSuperadmin: false, tenantId: T, roleCodes: ['cajero'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_CAJA).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (m, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('un mozo no puede ver el saldo ni cobrar la mesa', { skip: SKIP }, async () => {
  assert.equal((await req('GET', `/api/payments/sessions/${ctx.sessionId}/balance`, mozoH)).status, 403);
  assert.equal((await req('POST', `/api/payments/sessions/${ctx.sessionId}/charges`, mozoH, { mode: 'GROUP', provider: 'CASH' })).status, 403);
});

test('el cajero cobra la mesa en efectivo por HTTP', { skip: SKIP }, async () => {
  const bal = await req('GET', `/api/payments/sessions/${ctx.sessionId}/balance`, cajaH);
  assert.equal(bal.status, 200);
  assert.equal((await bal.json()).remaining, '4000.00');

  const charge = await req('POST', `/api/payments/sessions/${ctx.sessionId}/charges`, cajaH, { mode: 'GROUP', provider: 'CASH' });
  assert.equal(charge.status, 201);
  const p = await charge.json();
  assert.equal(p.status, 'APPROVED');
  const [[row]] = await db.query('SELECT id FROM payments WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [T]);
  ctx.paymentDbId = row.id;
});

test('un mozo no puede hacer una devolución; el cajero sí', { skip: SKIP }, async () => {
  const byMozo = await req('POST', `/api/payments/${ctx.paymentDbId}/refund`, mozoH, { reason: 'x' });
  assert.equal(byMozo.status, 403);
  const byCaja = await req('POST', `/api/payments/${ctx.paymentDbId}/refund`, cajaH, { reason: 'cliente se arrepintió' });
  assert.equal(byCaja.status, 200);
  assert.equal((await byCaja.json()).status, 'REFUNDED');
});
