// Aislamiento entre empresas para analítica — dos empresas con ventas del
// mismo producto/precio el mismo día; A nunca ve nada de B. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');
const analyticsSvc = require('../src/modules/analytics/analytics.service');

const TA = 998510;
const TB = 998511;
let ctx = {};
const staff = { kind: 'staff', actorId: null, req: {} };
const today = new Date().toISOString().slice(0, 10);

async function seed(tid, label, price) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `An ${label}`, `an-iso-${label.toLowerCase()}`]);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', 'Centro']);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [tid, c.insertId, 'x', 'X', price]);
  const o = await orderSvc.createOrder(tid, { branchId: b.insertId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(tid, o.id, { productCode: 'x', qty: 1 }, staff);
  await orderSvc.submitOrder(tid, o.id, staff);
  await paySvc.chargeOrder(tid, o.id, { provider: 'CASH' }, staff);
  return { branchId: b.insertId };
}

before(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  ctx.a = await seed(TA, 'A', '1000.00');
  ctx.b = await seed(TB, 'B', '5000.00'); // precio bien distinto: si se mezclaran, se notaría enseguida
});

after(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.end().catch(() => {});
});

test('el resumen de ventas de A no ve nada de la venta de B (ni al revés)', async () => {
  const summaryA = await analyticsSvc.salesSummary(TA, { branchId: ctx.a.branchId, from: today, to: today });
  const summaryB = await analyticsSvc.salesSummary(TB, { branchId: ctx.b.branchId, from: today, to: today });
  assert.equal(summaryA.gross, '1000.00');
  assert.equal(summaryB.gross, '5000.00');
});

test('top-products(A) no trae el producto de B', async () => {
  const topA = await analyticsSvc.topProducts(TA, { branchId: ctx.a.branchId, from: today, to: today });
  assert.equal(topA.length, 1);
  assert.equal(topA[0].gross, '1000.00');
});
