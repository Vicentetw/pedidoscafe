// Fidelización — ledger de puntos: ganar/canjear/ajustar, niveles, y la
// acumulación automática al cobrar un pedido de mostrador con cliente
// identificado (Fase 9 + Fase 10). Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const crmSvc = require('../src/modules/crm/crm.service');
const loyaltySvc = require('../src/modules/loyalty/loyalty.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');

const T = 998700;
let ctx = {};
const staff = { actorId: null, req: {} };

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Loyalty', 'loyalty-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1000.00']);
  const cust = await crmSvc.createCustomer(T, { name: 'Juana Socia', phone: '1166660000' }, {});
  ctx.customerId = cust.id;
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('sin regla activa, cobrar un pedido con cliente NO acredita puntos (no-op silencioso)', async () => {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER', customerId: ctx.customerId }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);
  const account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 0);
});

test('con una regla activa (1 punto cada $100), cobrar un pedido de mostrador con cliente acredita puntos solo', async () => {
  await loyaltySvc.createRule(T, { scope: 'GLOBAL', pointsPerAmount: 0.01, active: true }, {}); // 0.01 pt/$ = 1 pt/$100
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER', customerId: ctx.customerId }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, { kind: 'staff' }); // $1000
  await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);

  const account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 10); // 1000 * 0.01
  const txns = await loyaltySvc.listTransactions(T, ctx.customerId);
  assert.equal(txns.length, 1);
  assert.equal(txns[0].type, 'EARN');
  assert.equal(txns[0].ref_type, 'ORDER_PAYMENT');
});

test('un pedido sin cliente identificado no acredita nada (no explota)', async () => {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);
  const account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 10); // no cambió respecto del test anterior
});

test('canjear puntos resta del balance; canjear más de lo disponible se rechaza', async () => {
  await loyaltySvc.redeem(T, ctx.customerId, { points: 4, reason: 'Descuento en caja' }, staff);
  let account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 6);

  await assert.rejects(() => loyaltySvc.redeem(T, ctx.customerId, { points: 999, reason: 'de más' }, staff), /suficientes/);
  account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 6, 'un canje rechazado no debe tocar el balance');
});

test('un ajuste manual puede sumar o restar, y queda en el ledger con motivo', async () => {
  await loyaltySvc.adjust(T, ctx.customerId, { points: 100, reason: 'Corrección por error de sistema anterior' }, staff);
  let account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 106);

  await loyaltySvc.adjust(T, ctx.customerId, { points: -6, reason: 'Corrección de más' }, staff);
  account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 100);
});

test('niveles: el balance actual resuelve al nivel más alto que corresponde', async () => {
  await loyaltySvc.createTier(T, { code: 'bronce', name: 'Bronce', minPoints: 0, multiplier: 1 }, {});
  await loyaltySvc.createTier(T, { code: 'plata', name: 'Plata', minPoints: 100, multiplier: 1.5 }, {});
  await loyaltySvc.createTier(T, { code: 'oro', name: 'Oro', minPoints: 1000, multiplier: 2 }, {});

  await loyaltySvc.adjust(T, ctx.customerId, { points: 1, reason: 'empujoncito para cruzar a Plata' }, staff);
  const account = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(account.points_balance, 101);
  assert.equal(account.tier.code, 'plata');
});

test('acreditar dos veces el MISMO pago (reintento) no duplica puntos — idempotente', async () => {
  const before = await loyaltySvc.getAccount(T, ctx.customerId);
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER', customerId: ctx.customerId }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);
  const afterFirst = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.ok(afterFirst.points_balance > before.points_balance);

  // Simula un reintento: mismo refType/refId/type -> el UNIQUE del ledger lo frena.
  const { withTransaction } = require('../src/withTransaction');
  await withTransaction((conn) => require('../src/modules/loyalty/loyalty.service').earnForOrderPayment(T, { customerId: ctx.customerId, amountCents: 100000, orderId: o.id }, conn));
  const afterRetry = await loyaltySvc.getAccount(T, ctx.customerId);
  assert.equal(afterRetry.points_balance, afterFirst.points_balance, 'el reintento no debe sumar puntos de nuevo');
});
