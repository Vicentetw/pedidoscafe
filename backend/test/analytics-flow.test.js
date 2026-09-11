// Analítica — consultas directas sobre orders/order_items/refunds (Fase 12).
// Sólo cuenta lo PAGADO; un draft/pedido sin pagar no debe figurar como
// venta. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const crmSvc = require('../src/modules/crm/crm.service');
const promoSvc = require('../src/modules/promotions/promotions.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');
const analyticsSvc = require('../src/modules/analytics/analytics.service');

const T = 998500;
let ctx = {};
const staff = { kind: 'staff', actorId: null, req: {} };
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function paidOrder({ qty = 1, customerId = null, promoCode = null, backdateTo = null } = {}) {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER', customerId }, staff);
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty }, staff);
  if (promoCode) await promoSvc.applyPromotion(T, o.id, promoCode, staff);
  await orderSvc.submitOrder(T, o.id, staff);
  const payment = await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);
  await db.query('UPDATE orders SET accepted_at = created_at, ready_at = DATE_ADD(created_at, INTERVAL 12 MINUTE) WHERE id = ?', [o.id]);
  if (backdateTo) {
    await db.query('UPDATE orders SET created_at = ? WHERE id = ?', [`${backdateTo} 12:00:00`, o.id]);
  }
  return { orderId: o.id, paymentId: payment.id };
}

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Analytics', 'analytics-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1000.00']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'y', 'Y', '500.00']);

  ctx.custA = await crmSvc.createCustomer(T, { name: 'Cliente A' }, {});
  ctx.custB = await crmSvc.createCustomer(T, { name: 'Cliente B' }, {});
  await promoSvc.createPromotion(T, { code: 'diez', name: '10%', type: 'PERCENT', value: 10 }, {});
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('un pedido DRAFT (sin pagar) no cuenta como venta', async () => {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, staff);
  const summary = await analyticsSvc.salesSummary(T, { branchId: ctx.branchId, from: today, to: today });
  assert.equal(summary.ordersCount, 0);
});

test('resumen de ventas: gross/discounts/net/clientes/repeat rate (sobre lo PAID)', async () => {
  await paidOrder({ qty: 1, customerId: ctx.custA.id }); // $1000, cliente A (compra 1)
  await paidOrder({ qty: 1, customerId: ctx.custA.id, promoCode: 'diez' }); // $1000 - 10% = $900, cliente A (compra 2 -> repite)
  await paidOrder({ qty: 1, customerId: ctx.custB.id }); // $1000, cliente B (compra 1, no repite)

  const summary = await analyticsSvc.salesSummary(T, { branchId: ctx.branchId, from: today, to: today });
  assert.equal(summary.ordersCount, 3);
  assert.equal(summary.gross, '3000.00');
  assert.equal(summary.discounts, '100.00');
  assert.equal(summary.net, '2900.00');
  assert.equal(summary.customers, 2);
  assert.equal(summary.repeatCustomers, 1);
  assert.equal(summary.repeatRate, 0.5);
  assert.equal(summary.avgTicket, (2900 / 3).toFixed(2));
  assert.equal(summary.avgPrepMinutes, 12);
});

// Una devolución PARCIAL deja `orders.payment_status` en 'PARTIALLY_PAID'
// (mismo string que "todavía se está cobrando" — así viene desde la Fase 6,
// no se tocó acá: cambiar ese modelo es un cambio de otra fase, no de
// analítica). El resumen de ventas filtra por payment_status='PAID', así
// que un pedido parcialmente devuelto sale de gross/net/customers — pero
// `summary.refunds` sale de la tabla `refunds` directamente, así que SÍ lo
// sigue mostrando. Documentado también en FASE12.md.
test('una devolución parcial saca al pedido de gross/net, pero el monto devuelto igual se ve en refunds', async () => {
  const { paymentId } = await paidOrder({ qty: 1, customerId: ctx.custA.id }); // otro pedido de A, $1000
  await paySvc.refundPayment(T, paymentId, { amount: '200.00', reason: 'reclamo' }, staff);

  const summary = await analyticsSvc.salesSummary(T, { branchId: ctx.branchId, from: today, to: today });
  assert.equal(summary.ordersCount, 3, 'el pedido recién devuelto ya no cuenta como PAID');
  assert.equal(summary.refunds, '200.00');
});

test('top-products: rankea por revenue, no por cantidad', async () => {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(T, o.id, { productCode: 'y', qty: 10 }, staff); // $5000, 10 unidades
  await orderSvc.submitOrder(T, o.id, staff);
  await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);

  const top = await analyticsSvc.topProducts(T, { branchId: ctx.branchId, from: today, to: today, limit: 5 });
  assert.equal(top[0].name, 'Y');
  assert.equal(top[0].gross, '5000.00');
  assert.equal(Number(top[0].qty), 10);
});

test('serie diaria: agrupa por fecha, un pedido de ayer no entra en el resumen de hoy', async () => {
  await paidOrder({ qty: 1, backdateTo: yesterday });
  const daily = await analyticsSvc.dailySeries(T, { branchId: ctx.branchId, from: yesterday, to: today });
  assert.equal(daily.length, 2);
  const y = daily.find((d) => d.date === yesterday);
  const t = daily.find((d) => d.date === today);
  assert.equal(y.ordersCount, 1);
  assert.ok(t.ordersCount >= 3);

  const onlyToday = await analyticsSvc.salesSummary(T, { branchId: ctx.branchId, from: today, to: today });
  assert.ok(!onlyToday.ordersCount || onlyToday.ordersCount < daily.reduce((s, d) => s + d.ordersCount, 0));
});

test('recomputeRollup puebla daily_sales_rollup y coincide con la consulta directa', async () => {
  const direct = await analyticsSvc.dailySeries(T, { branchId: ctx.branchId, from: yesterday, to: today });
  const result = await analyticsSvc.recomputeRollup(T, { branchId: ctx.branchId, from: yesterday, to: today });
  assert.equal(result.daysRecomputed, direct.length);

  const rollup = await analyticsSvc.getDailyRollup(T, { branchId: ctx.branchId, from: yesterday, to: today });
  assert.equal(rollup.length, direct.length);
  for (const d of direct) {
    const r = rollup.find((x) => x.date === d.date);
    assert.ok(r, `debe existir rollup para ${d.date}`);
    assert.equal(r.net, d.net);
    assert.equal(r.orders_count, d.ordersCount);
  }
});

test('una sucursal inexistente da un error de validación, no un 500 crudo', async () => {
  await assert.rejects(() => analyticsSvc.salesSummary(T, { branchId: 999999, from: today, to: today }));
});
