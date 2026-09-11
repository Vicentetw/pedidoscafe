// Pedidos de mostrador + KDS por HTTP con ID token real de Firebase.
// Gating: mozo crea/edita pero NO cancela ni cambia prioridad; encargado sí.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 999840;
const UID_ENC = 'test-orders-enc';
const UID_MOZO = 'test-orders-mozo';
let srv;
let encH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Pedidos admin', 'pedidos-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'cafe', 'Café', '2500.00']);
  encH = await getTestAuthHeaders(UID_ENC, { isSuperadmin: false, tenantId: T, roleCodes: ['encargado'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_ENC).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (m, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('mozo crea un pedido de mostrador, agrega ítem y lo envía', { skip: SKIP }, async () => {
  const o = await (await req('POST', '/api/orders', mozoH, { branchId: ctx.branchId, channel: 'COUNTER' })).json();
  assert.ok(o.public_id);
  const withItem = await req('POST', `/api/orders/${o.id}/items`, mozoH, { productCode: 'cafe', qty: 2 });
  assert.equal(withItem.status, 201);
  assert.equal((await withItem.json()).total, '5000.00');
  const submitted = await req('POST', `/api/orders/${o.id}/submit`, mozoH);
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).status, 'QUEUED');
  ctx.orderId = o.id;
});

test('mozo NO puede cancelar (le falta orders:cancel) -> 403; encargado sí', { skip: SKIP }, async () => {
  const byMozo = await req('POST', `/api/orders/${ctx.orderId}/cancel`, mozoH, { reason: 'x' });
  assert.equal(byMozo.status, 403);
  const byEnc = await req('POST', `/api/orders/${ctx.orderId}/cancel`, encH, { reason: 'cliente se arrepintió' });
  assert.equal(byEnc.status, 200);
  assert.equal((await byEnc.json()).status, 'CANCELLED');
  const [[a]] = await db.query("SELECT reason FROM audit_log WHERE tenant_id = ? AND action = 'cancel'", [T]);
  assert.match(a.reason, /arrepin/);
});

test('mozo NO puede cambiar prioridad (le falta orders:set_priority) -> 403', { skip: SKIP }, async () => {
  const o = await (await req('POST', '/api/orders', encH, { branchId: ctx.branchId, channel: 'COUNTER' })).json();
  await req('POST', `/api/orders/${o.id}/items`, encH, { productCode: 'cafe', qty: 1 });
  await req('POST', `/api/orders/${o.id}/submit`, encH);
  assert.equal((await req('POST', `/api/orders/${o.id}/priority`, mozoH, { priority: 'URGENT' })).status, 403);
  assert.equal((await req('POST', `/api/orders/${o.id}/priority`, encH, { priority: 'URGENT' })).status, 200);
  ctx.order2 = o.id;
});

test('KDS: el tablero muestra el ticket y se avanza con kitchen:advance_ticket', { skip: SKIP }, async () => {
  const board = await (await req('GET', `/api/kitchen/tickets?branchId=${ctx.branchId}`, encH)).json();
  assert.ok(board.data.length >= 1);
  const tk = board.data.find((t) => t.order_id === ctx.order2);
  assert.ok(tk, 'el ticket del pedido urgente está en el tablero');
  const adv = await req('POST', `/api/kitchen/tickets/${tk.id}/advance`, encH);
  assert.equal(adv.status, 200);
  assert.equal((await adv.json()).ticketStatus, 'PREPARING');
  // un mozo no puede avanzar tickets
  assert.equal((await req('POST', `/api/kitchen/tickets/${tk.id}/advance`, mozoH)).status, 403);
});

test('el catálogo rechaza un precio inyectado en el ítem (mandatory case #4, vía HTTP staff)', { skip: SKIP }, async () => {
  const o = await (await req('POST', '/api/orders', encH, { branchId: ctx.branchId, channel: 'COUNTER' })).json();
  const r = await req('POST', `/api/orders/${o.id}/items`, encH, { productCode: 'cafe', qty: 1, unit_price: '1.00', price: 1 });
  assert.equal((await r.json()).items[0].unit_price, '2500.00');
});
