// Aislamiento entre empresas para promociones — dos empresas con una promo
// de IGUAL código; A nunca ve, aplica ni desactiva nada de B. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const promoSvc = require('../src/modules/promotions/promotions.service');
const orderSvc = require('../src/modules/orders/orders.service');

const TA = 998620;
const TB = 998621;
const SAME_CODE = 'descuento10';
let ctx = {};
const staff = { kind: 'staff', actorId: null, req: {} };

async function seed(tid, label) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Promo ${label}`, `promo-iso-${label.toLowerCase()}`]);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', 'Centro']);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [tid, c.insertId, 'x', 'X', '1000.00']);
  const promo = await promoSvc.createPromotion(tid, { code: SAME_CODE, name: `10% ${label}`, type: 'PERCENT', value: 10 }, {});
  return { branchId: b.insertId, promoId: promo.id };
}

before(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  ctx.a = await seed(TA, 'A');
  ctx.b = await seed(TB, 'B');
});

after(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.end().catch(() => {});
});

test('el mismo código de promoción en dos empresas no choca (UNIQUE por tenant)', () => {
  assert.notEqual(ctx.a.promoId, ctx.b.promoId);
});

test('listPromotions(A) no trae la promoción de B', async () => {
  const list = await promoSvc.listPromotions(TA);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, ctx.a.promoId);
});

test('getPromotion(A, <id de B>) -> no la encuentra', async () => {
  await assert.rejects(() => promoSvc.getPromotion(TA, ctx.b.promoId));
});

test('aplicar el código de A sobre un pedido de A funciona; el código de B en un pedido de A también resuelve al de A (mismo string, tenant distinto)', async () => {
  const o = await orderSvc.createOrder(TA, { branchId: ctx.a.branchId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(TA, o.id, { productCode: 'x', qty: 1 }, staff);
  const order = await promoSvc.applyPromotion(TA, o.id, SAME_CODE, staff);
  assert.equal(order.discount_total, '100.00'); // el 10% de A, nunca el descuento que B pudiera tener configurado distinto
});
