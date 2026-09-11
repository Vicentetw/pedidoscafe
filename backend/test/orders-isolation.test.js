// Aislamiento entre empresas — pedidos. Dos empresas con producto de igual
// código; un pedido de A nunca resuelve/lista bajo B. Nivel repo + servicio.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const repo = require('../src/modules/orders/orders.repository');
const svc = require('../src/modules/orders/orders.service');

const TA = 999830;
const TB = 999831;
let a = {};
let b = {};

async function seed(tid, label, price) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Ord ${label}`, `ord-${label.toLowerCase()}-iso`]);
  const [br] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', `C ${label}`]);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [tid, c.insertId, 'x', `X ${label}`, price]);
  const o = await svc.createOrder(tid, { branchId: br.insertId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await svc.addItem(tid, o.id, { productCode: 'x', qty: 1 }, { kind: 'staff' });
  return { branchId: br.insertId, orderId: o.id };
}

before(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  a = await seed(TA, 'A', '1000.00');
  b = await seed(TB, 'B', '2000.00');
});

after(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.end().catch(() => {});
});

test('findOrder(A, <pedido de B>) -> null', async () => {
  assert.equal(await repo.findOrder(TA, b.orderId), null);
  assert.ok(await repo.findOrder(TB, b.orderId));
});

test('listOrders(A) sólo trae pedidos de A', async () => {
  const rows = await repo.listOrders(TA, {});
  assert.ok(rows.length >= 1 && rows.every((o) => o.tenant_id === TA));
});

test('el precio del ítem usa el catálogo de A (1000), no el de B (2000)', async () => {
  const o = await svc.getOrder(TA, a.orderId);
  assert.equal(o.items[0].line_total, '1000.00');
});

test('submit + ruteo de A no toca datos de B', async () => {
  await svc.submitOrder(TA, a.orderId, { kind: 'staff', actorId: null });
  const [tickets] = await db.query('SELECT tenant_id FROM kitchen_tickets WHERE order_id = ?', [a.orderId]);
  assert.ok(tickets.every((t) => t.tenant_id === TA));
  const [[b1]] = await db.query('SELECT status FROM orders WHERE id = ?', [b.orderId]);
  assert.equal(b1.status, 'DRAFT', 'el pedido de B sigue intacto');
});

test('addItem sobre un order_id de B usando tenant A -> falla (no lo encuentra)', async () => {
  await assert.rejects(() => svc.addItem(TA, b.orderId, { productCode: 'x', qty: 1 }, { kind: 'staff' }));
});
