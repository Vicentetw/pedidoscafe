// Falla 7 — los reportes de ventas cuentan los pedidos con
// payment_status = 'PAID'. Dos errores:
// - una mesa saldada con cuenta dividida (SPLIT) nunca marcaba sus pedidos
//   como pagados: esa venta no aparecía en ningún reporte;
// - un pedido cobrado y después cancelado seguía contando como venta.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { openCash } = require('./helpers/cash');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');
const analytics = require('../src/modules/analytics/analytics.service');

const T = 998945;
const guest = { kind: 'guest', actorId: null };
const staff = { kind: 'staff', actorId: null, canAmendPaid: true, req: {} };
const RANGE = { from: '2000-01-01', to: '2100-01-01' };
let ctx = {};
let n = 0;

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Ventas exactas', 'ventas-exactas-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  await openCash(T, ctx.branchId);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'cafe', 'Café', '1000.00']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

// Mesa con un pedido confirmado de $1000.
async function tableWithOrder() {
  n += 1;
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, `V${n}`]);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, t.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: `Cli${n}` }, {});
  const [[part]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sess.id, participantId: part.id, channel: 'TABLE' }, guest);
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, guest);
  await orderSvc.submitOrder(T, o.id, guest);
  return { sessionId: sess.id, orderId: o.id };
}
const summary = () => analytics.salesSummary(T, { branchId: ctx.branchId, ...RANGE });
const sold = async () => { const s = await summary(); return { count: s.ordersCount, net: Number(s.net) }; };

test('mesa saldada con "dividir en partes iguales" cuenta como venta', async () => {
  const before = await sold();
  const { sessionId } = await tableWithOrder();
  await paySvc.splitEqual(T, sessionId, 2, staff);
  const now = await sold();
  assert.equal(now.count, before.count + 1);
  assert.equal(now.net, before.net + 1000);
});

test('mesa saldada con montos sueltos (SPLIT) cuenta recién cuando se completa', async () => {
  const before = await sold();
  const { sessionId } = await tableWithOrder();
  await paySvc.chargeSession(T, sessionId, { mode: 'SPLIT', provider: 'CASH', amount: '400.00' }, staff);
  assert.equal((await sold()).count, before.count, 'a medio pagar todavía no es venta cerrada');
  await paySvc.chargeSession(T, sessionId, { mode: 'SPLIT', provider: 'CASH', amount: '600.00' }, staff);
  const now = await sold();
  assert.equal(now.count, before.count + 1);
  assert.equal(now.net, before.net + 1000);
});

test('un pedido cobrado y después cancelado no cuenta como venta', async () => {
  const { sessionId, orderId } = await tableWithOrder();
  await paySvc.chargeSession(T, sessionId, { mode: 'GROUP', provider: 'CASH' }, staff);
  const paid = await sold();
  await orderSvc.cancelOrder(T, orderId, { reason: 'cliente se fue' }, staff);
  const now = await sold();
  assert.equal(now.count, paid.count - 1);
  assert.equal(now.net, paid.net - 1000);
  const top = await analytics.topProducts(T, { branchId: ctx.branchId, ...RANGE });
  const cafe = top.find((p) => p.name === 'Café');
  assert.equal(Number(cafe.qty), now.count, 'el ranking de productos tampoco cuenta el cancelado');
});
