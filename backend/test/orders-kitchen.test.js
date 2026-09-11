// Ruteo a estaciones + KDS. Sin Firebase (usa los services directo para
// el circuito de cocina; los endpoints /api/kitchen se prueban en
// orders-admin.test.js con permisos reales).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const orderSvc = require('../src/modules/orders/orders.service');
const kitchenSvc = require('../src/modules/orders/kitchen.service');
const kitchenRepo = require('../src/modules/orders/kitchen.repository');

const T = 999820;
let ctx = {};

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Cocina', 'cocina-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [cCafe] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'cafe', 'Café']);
  const [cBebida] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'bebida', 'Bebidas']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, cCafe.insertId, 'latte', 'Latte', '4000.00']);
  const [pCerveza] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price, requires_age_verification) VALUES (?, ?, ?, ?, ?, 1)', [T, cBebida.insertId, 'cerveza', 'Cerveza', '3500.00']);
  ctx.cervezaCat = cBebida.insertId;
  void pCerveza;

  ctx.stCocina = await kitchenRepo.createStation(T, { branchId: ctx.branchId, code: 'cocina', name: 'Cocina', type: 'KITCHEN', isDefault: true });
  ctx.stBarra = await kitchenRepo.createStation(T, { branchId: ctx.branchId, code: 'barra', name: 'Barra', type: 'BAR' });
  // las bebidas van a la barra
  await kitchenRepo.upsertRouting(T, ctx.branchId, { categoryId: ctx.cervezaCat, stationId: ctx.stBarra });
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

async function newOrder() {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  return o.id;
}

test('un pedido con ítems de dos estaciones genera DOS tickets', async () => {
  const id = await newOrder();
  await orderSvc.addItem(T, id, { productCode: 'latte', qty: 1 }, { kind: 'staff' });
  await orderSvc.addItem(T, id, { productCode: 'cerveza', qty: 2 }, { kind: 'staff' });
  await orderSvc.submitOrder(T, id, { kind: 'staff', actorId: null });

  const [tickets] = await db.query('SELECT station_id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, id]);
  assert.equal(tickets.length, 2);
  const stations = tickets.map((t) => t.station_id).sort();
  assert.deepEqual(stations, [ctx.stCocina, ctx.stBarra].sort());
  ctx.orderId = id;
});

test('el pedido no pasa a DELIVERED mientras haya verificación de edad pendiente (§28)', async () => {
  // pedido nuevo con SÓLO la cerveza (un ticket, en la barra)
  const id = await newOrder();
  await orderSvc.addItem(T, id, { productCode: 'cerveza', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(T, id, { kind: 'staff', actorId: null });
  const [[item]] = await db.query("SELECT id, age_check FROM order_items WHERE order_id = ?", [id]);
  assert.equal(item.age_check, 'REQUIRED', 'la cerveza requiere verificación de edad');

  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, id]);
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // QUEUED -> PREPARING
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // PREPARING -> READY
  const r = await kitchenSvc.advanceTicket(T, tk.id, {}, null); // ticket -> DELIVERED, pero...
  assert.equal(r.orderStatus, 'READY', 'el pedido NO pasa a DELIVERED: edad sin verificar');

  await orderSvc.verifyAge(T, id, item.id, 'VERIFIED', { kind: 'staff', req: {} });
  const pending = await require('../src/modules/orders/orders.repository').countUnresolvedAgeChecks(T, id);
  assert.equal(pending, 0, 'ya no hay verificaciones pendientes');
});

test('sucursal sin estaciones -> un solo ticket "general" (station_id NULL)', async () => {
  const T2 = 999821;
  await resetTenant(T2);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T2, 'SinEst', 'sinest-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T2, 'c', 'C']);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T2, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T2, m.insertId, 'x', 'X']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T2, c.insertId, 'agua', 'Agua', '900.00']);

  const o = await orderSvc.createOrder(T2, { branchId: b.insertId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T2, o.id, { productCode: 'agua', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(T2, o.id, { kind: 'staff', actorId: null });
  const [tk] = await db.query('SELECT station_id FROM kitchen_tickets WHERE tenant_id = ?', [T2]);
  assert.equal(tk.length, 1);
  assert.equal(tk[0].station_id, null);
  await resetTenant(T2);
});
