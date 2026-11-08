// Falla 6 — sin stock, el backend respondía HTTP 200 con { error, code }.
// Angular trata 200 como éxito: el comensal veía "pedido confirmado" y el
// mozo veía la pantalla del pedido rota. Ahora es 409 con el mismo mensaje
// humano y el mismo code ITEM_UNAVAILABLE.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');
const orderSvc = require('../src/modules/orders/orders.service');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998975;
const UID = 'test-stock-http-enc';
const staff = { kind: 'staff', actorId: null, canAmendPaid: true, req: {} };
let srv;
let h;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Stock HTTP', 'stock-http-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query(
    'INSERT INTO products (tenant_id, category_id, code, name, base_price, track_stock, stock_qty) VALUES (?, ?, ?, ?, ?, 1, 1)',
    [T, c.insertId, 'medialuna', 'Medialuna', '500.00']
  );
  h = await getTestAuthHeaders(UID, { isSuperadmin: false, tenantId: T, roleCodes: ['encargado'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

async function counterOrder(qty) {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(T, o.id, { productCode: 'medialuna', qty }, staff);
  return o.id;
}

test('confirmar un pedido sin stock responde 409 (no 200) con mensaje humano y code ITEM_UNAVAILABLE', { skip: SKIP }, async () => {
  const id = await counterOrder(5); // queda 1
  const res = await fetch(`${srv.baseUrl}/api/orders/${id}/submit`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'ITEM_UNAVAILABLE');
  assert.match(body.error, /agot|stock/i);
  assert.ok(!/409|conflict/i.test(body.error), 'el mensaje sigue siendo humano');
  const [[o]] = await db.query('SELECT status FROM orders WHERE id = ?', [id]);
  assert.equal(o.status, 'REJECTED_STOCK');
});

test('agregar o subir cantidad sin stock en un pedido confirmado también es 409', { skip: SKIP }, async () => {
  const id = await counterOrder(1);
  await orderSvc.submitOrder(T, id, staff); // consume la única unidad
  const [[item]] = await db.query('SELECT id FROM order_items WHERE order_id = ?', [id]);
  const is409 = (e) => { assert.equal(e.code, 'ITEM_UNAVAILABLE'); assert.equal(e.status, 409); return true; };
  await assert.rejects(() => orderSvc.addItem(T, id, { productCode: 'medialuna', qty: 1 }, staff), is409);
  await assert.rejects(() => orderSvc.updateItem(T, id, item.id, { qty: 2 }, staff), is409);
});
