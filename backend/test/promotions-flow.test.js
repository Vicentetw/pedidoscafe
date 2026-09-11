// Promociones — PERCENT/FIXED, condiciones, combinabilidad, idempotencia, y
// que el descuento sobrevive a agregar/sacar ítems después de aplicar la
// promo (el bug que este diseño evita: sumTotals() resetea discount a 0 en
// cada addItem/removeItem si nadie lo recalcula). Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const crmSvc = require('../src/modules/crm/crm.service');
const loyaltySvc = require('../src/modules/loyalty/loyalty.service');
const promoSvc = require('../src/modules/promotions/promotions.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');

const T = 998600;
let ctx = {};
const staff = { kind: 'staff', actorId: null, req: {} };

async function draftOrder(qty = 1) {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty }, staff);
  return o.id;
}

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Promo', 'promo-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1000.00']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('no se puede crear una promoción BOGO/COMBO/FREE_ITEM/HAPPY_HOUR (sin motor de cálculo todavía)', async () => {
  await assert.rejects(() => promoSvc.createPromotion(T, { code: 'x2x1', name: 'x', type: 'BOGO' }, {}), /motor de cálculo/);
});

test('PERCENT: aplicar un 10% descuenta el 10% del subtotal', async () => {
  await promoSvc.createPromotion(T, { code: 'diez', name: '10% off', type: 'PERCENT', value: 10 }, {});
  const orderId = await draftOrder(1); // $1000
  const order = await promoSvc.applyPromotion(T, orderId, 'diez', staff);
  assert.equal(order.discount_total, '100.00');
  assert.equal(order.total, '900.00');
  ctx.orderPercent = orderId;
});

test('aplicar la MISMA promoción dos veces es idempotente (no duplica el descuento)', async () => {
  const order = await promoSvc.applyPromotion(T, ctx.orderPercent, 'diez', staff);
  assert.equal(order.discount_total, '100.00');
});

test('el descuento sobrevive a agregar otro ítem después: se recalcula sobre el nuevo subtotal', async () => {
  await orderSvc.addItem(T, ctx.orderPercent, { productCode: 'x', qty: 1 }, staff); // ahora $2000
  const order = await orderSvc.getOrder(T, ctx.orderPercent);
  assert.equal(order.subtotal, '2000.00');
  assert.equal(order.discount_total, '200.00', 'el 10% se debe recalcular sobre el subtotal nuevo, no quedar pisado en 0');
  assert.equal(order.total, '1800.00');
});

test('sacar la promoción vuelve el descuento a $0', async () => {
  const order = await promoSvc.removePromotion(T, ctx.orderPercent, 'diez', staff);
  assert.equal(order.discount_total, '0.00');
  assert.equal(order.total, order.subtotal);
});

test('FIXED: descuenta un monto fijo, nunca más que el subtotal', async () => {
  await promoSvc.createPromotion(T, { code: 'fijo500', name: '$500 off', type: 'FIXED', value: 500 }, {});
  const orderId = await draftOrder(1); // $1000
  let order = await promoSvc.applyPromotion(T, orderId, 'fijo500', staff);
  assert.equal(order.discount_total, '500.00');
  assert.equal(order.total, '500.00');

  await promoSvc.createPromotion(T, { code: 'fijo5000', name: '$5000 off', type: 'FIXED', value: 5000 }, {});
  await promoSvc.removePromotion(T, orderId, 'fijo500', staff);
  order = await promoSvc.applyPromotion(T, orderId, 'fijo5000', staff);
  assert.equal(order.discount_total, '1000.00', 'el descuento nunca puede superar el subtotal');
  assert.equal(order.total, '0.00');
});

test('MIN_AMOUNT: rechaza si el pedido no llega al mínimo, funciona si llega', async () => {
  const promo = await promoSvc.createPromotion(T, { code: 'grande', name: 'Compra grande', type: 'PERCENT', value: 15 }, {});
  await promoSvc.addRule(T, promo.id, { conditionType: 'MIN_AMOUNT', value: { amount: '1500.00' } }, {});

  const chico = await draftOrder(1); // $1000
  await assert.rejects(() => promoSvc.applyPromotion(T, chico, 'grande', staff), /mínimo/);

  const grande = await draftOrder(2); // $2000
  const order = await promoSvc.applyPromotion(T, grande, 'grande', staff);
  assert.equal(order.discount_total, '300.00');
});

test('no stackable: no se puede combinar con otra promoción ya aplicada', async () => {
  await promoSvc.createPromotion(T, { code: 'solita', name: 'Sola', type: 'PERCENT', value: 5, stackable: false }, {});
  await promoSvc.createPromotion(T, { code: 'combinable', name: 'Combinable', type: 'FIXED', value: 50, stackable: true }, {});
  const orderId = await draftOrder(1);
  await promoSvc.applyPromotion(T, orderId, 'solita', staff);
  await assert.rejects(() => promoSvc.applyPromotion(T, orderId, 'combinable', staff), /combina/);
});

test('stackable + stackable: se suman los descuentos', async () => {
  await promoSvc.createPromotion(T, { code: 'combi1', name: 'Combi 1', type: 'PERCENT', value: 5, stackable: true }, {});
  await promoSvc.createPromotion(T, { code: 'combi2', name: 'Combi 2', type: 'FIXED', value: 50, stackable: true }, {});
  const orderId = await draftOrder(1); // $1000
  await promoSvc.applyPromotion(T, orderId, 'combi1', staff); // -$50 (5%)
  const order = await promoSvc.applyPromotion(T, orderId, 'combi2', staff); // -$50 más
  assert.equal(order.discount_total, '100.00');
});

test('CUSTOMER_TIER: exige el nivel de fidelización del cliente', async () => {
  await loyaltySvc.createTier(T, { code: 'oro', name: 'Oro', minPoints: 1000 }, {});
  const cust = await crmSvc.createCustomer(T, { name: 'Cliente Oro' }, {});
  const promo = await promoSvc.createPromotion(T, { code: 'vip', name: 'Sólo VIP', type: 'PERCENT', value: 20 }, {});
  await promoSvc.addRule(T, promo.id, { conditionType: 'CUSTOMER_TIER', value: { tierCode: 'oro' } }, {});

  const o1 = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER', customerId: cust.id }, staff);
  await orderSvc.addItem(T, o1.id, { productCode: 'x', qty: 1 }, staff);
  await assert.rejects(() => promoSvc.applyPromotion(T, o1.id, 'vip', staff), /nivel de fidelización/);

  await loyaltySvc.adjust(T, cust.id, { points: 1000, reason: 'para el test' }, staff);
  const order = await promoSvc.applyPromotion(T, o1.id, 'vip', staff);
  assert.equal(order.discount_total, '200.00');
});

test('un pedido sin cliente identificado no puede usar una promo CUSTOMER_TIER', async () => {
  const promo = await promoSvc.createPromotion(T, { code: 'vip2', name: 'VIP 2', type: 'PERCENT', value: 20 }, {});
  await promoSvc.addRule(T, promo.id, { conditionType: 'CUSTOMER_TIER', value: { tierCode: 'oro' } }, {});
  const orderId = await draftOrder(1);
  await assert.rejects(() => promoSvc.applyPromotion(T, orderId, 'vip2', staff), /cliente identificado/);
});

test('no se puede aplicar ni sacar una promoción de un pedido YA pagado', async () => {
  await promoSvc.createPromotion(T, { code: 'tarde', name: 'Tarde', type: 'PERCENT', value: 10 }, {});
  const orderId = await draftOrder(1);
  await orderSvc.submitOrder(T, orderId, staff);
  await paySvc.chargeOrder(T, orderId, { provider: 'CASH' }, staff);
  await assert.rejects(() => promoSvc.applyPromotion(T, orderId, 'tarde', staff), /pago registrado/);
});
