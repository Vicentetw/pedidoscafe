// Falla 5 (sin devoluciones, por decisión del dueño):
// - cancelar un pedido YA cobrado no mueve dinero, pero exige motivo,
//   queda auditado y aparece en conciliación para que alguien lo revise;
//   el comensal no puede cancelar un pedido ya cobrado.
// - cambiar la cantidad de un ítem de un pedido confirmado ajusta el stock
//   simple y el ticket de cocina, y toda modificación queda auditada.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');

const T = 998485;
let ctx = {};
const guest = { kind: 'guest', actorId: null };
const staff = { kind: 'staff', actorId: null, canAmendPaid: true, req: {} };

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Amend Cancel', 'amend-cancel-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  const [p] = await db.query(
    'INSERT INTO products (tenant_id, category_id, code, name, base_price, track_stock, stock_qty) VALUES (?, ?, ?, ?, ?, 1, 10)',
    [T, c.insertId, 'cafe', 'Café', '1000.00']
  );
  ctx.productId = p.insertId;
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

let n = 0;
async function freshOrder() {
  n += 1;
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, `AC${n}`]);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, t.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: `Cli${n}` }, {});
  const [[part]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sess.id, participantId: part.id, channel: 'TABLE' }, guest);
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, guest);
  await orderSvc.submitOrder(T, o.id, guest);
  const [[item]] = await db.query('SELECT id FROM order_items WHERE order_id = ?', [o.id]);
  return { orderId: o.id, sessionId: sess.id, itemId: item.id };
}
async function markPaid(orderId) {
  await db.query("UPDATE orders SET payment_status = 'PAID' WHERE id = ?", [orderId]);
}
const stockQty = async () => (await db.query('SELECT stock_qty FROM products WHERE id = ?', [ctx.productId]))[0][0].stock_qty;
const auditActions = async (entityId) =>
  (await db.query('SELECT action FROM audit_log WHERE tenant_id = ? AND entity_id = ? ORDER BY id', [T, String(entityId)]))[0].map((r) => r.action);

test('cancelar un pedido ya cobrado sin motivo -> 422; con motivo se cancela, queda auditado y en conciliación', async () => {
  const { orderId } = await freshOrder();
  await markPaid(orderId);

  await assert.rejects(() => orderSvc.cancelOrder(T, orderId, {}, staff), (e) => { assert.equal(e.status, 422); return true; });
  const [[still]] = await db.query('SELECT status FROM orders WHERE id = ?', [orderId]);
  assert.notEqual(still.status, 'CANCELLED');

  await orderSvc.cancelOrder(T, orderId, { reason: 'se equivocó de mesa' }, staff);
  assert.ok((await auditActions(orderId)).includes('cancel_paid'));

  const rec = await paySvc.getReconciliation(T, ctx.branchId);
  assert.ok(rec.cancelledPaidOrders.some((o) => o.id === orderId), 'el pedido cancelado ya cobrado aparece para revisar');
  const [[{ r }]] = await db.query('SELECT COUNT(*) r FROM refunds WHERE tenant_id = ?', [T]);
  assert.equal(r, 0, 'no se crea ninguna devolución');
});

test('el comensal no puede cancelar un pedido ya cobrado', async () => {
  const { orderId } = await freshOrder();
  await markPaid(orderId);
  await assert.rejects(() => orderSvc.cancelOrder(T, orderId, {}, guest), (e) => { assert.equal(e.status, 403); return true; });
});

test('cancelar un pedido sin cobrar sigue igual que antes (sin motivo obligatorio)', async () => {
  const { orderId } = await freshOrder();
  const o = await orderSvc.cancelOrder(T, orderId, {}, staff);
  assert.equal(o.status, 'CANCELLED');
});

test('subir la cantidad de un ítem confirmado descuenta stock y actualiza cocina; bajarla lo devuelve', async () => {
  const { orderId, itemId } = await freshOrder();
  const before = await stockQty();

  await orderSvc.updateItem(T, orderId, itemId, { qty: 3 }, staff);
  assert.equal(await stockQty(), before - 2, 'se descuentan las 2 unidades nuevas');
  const [[kti]] = await db.query('SELECT qty FROM kitchen_ticket_items WHERE order_item_id = ?', [itemId]);
  assert.equal(kti.qty, 3, 'cocina ve la cantidad nueva');

  await orderSvc.updateItem(T, orderId, itemId, { qty: 1 }, staff);
  assert.equal(await stockQty(), before, 'bajar la cantidad devuelve el stock');
  const [[kti2]] = await db.query('SELECT qty FROM kitchen_ticket_items WHERE order_item_id = ?', [itemId]);
  assert.equal(kti2.qty, 1);
});

test('subir la cantidad sin stock suficiente se rechaza y no cambia nada', async () => {
  const { orderId, itemId } = await freshOrder();
  const before = await stockQty();
  await assert.rejects(() => orderSvc.updateItem(T, orderId, itemId, { qty: before + 5 }, staff), (e) => { assert.equal(e.code, 'ITEM_UNAVAILABLE'); return true; });
  assert.equal(await stockQty(), before);
  const [[it]] = await db.query('SELECT qty FROM order_items WHERE id = ?', [itemId]);
  assert.equal(it.qty, 1);
});

test('agregar, cambiar y sacar ítems de un pedido confirmado queda auditado', async () => {
  const { orderId, itemId } = await freshOrder();
  await orderSvc.addItem(T, orderId, { productCode: 'cafe', qty: 1 }, staff);
  await orderSvc.updateItem(T, orderId, itemId, { qty: 2 }, staff);
  await orderSvc.removeItem(T, orderId, itemId, staff);
  const actions = await auditActions(orderId);
  for (const a of ['amend_add', 'amend_qty', 'amend_remove']) assert.ok(actions.includes(a), `falta ${a} en ${actions}`);
});
