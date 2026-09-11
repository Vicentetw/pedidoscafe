// Conciliación (prompt.txt §34) construida desde el propio ledger. Arma
// las 4 categorías de discrepancia a mano y verifica que el endpoint las
// detecta, cada una en su categoría, y sólo las de esta empresa/sucursal.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const paySvc = require('../src/modules/payments/payments.service');
const payRepo = require('../src/modules/payments/payments.repository');

const T = 998960;
let ctx = {};

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Reconc', 'reconc-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;

  // 1) pago PENDING viejo (más de 30' — se fuerza el created_at hacia atrás)
  const { id: stalePaymentId } = await payRepo.createPayment(T, { branchId: ctx.branchId, kind: 'ORDER', provider: 'MERCADOPAGO', amount: '1000.00' });
  await payRepo.setPaymentStatus(T, stalePaymentId, 'PENDING');
  await db.query('UPDATE payments SET created_at = DATE_SUB(NOW(), INTERVAL 90 MINUTE) WHERE id = ?', [stalePaymentId]);

  // 2) pedido de mostrador entregado sin cobrar
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  const [p] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '2000.00']);
  await db.query(
    "INSERT INTO orders (public_id, tenant_id, branch_id, channel, status, payment_status, total, delivered_at) VALUES ('01RECONCORDERUNPAIDAAAA', ?, ?, 'COUNTER', 'DELIVERED', 'UNPAID', 2000.00, NOW())",
    [T, ctx.branchId]
  );
  void p;

  // 3) mesa cerrada por la fuerza con saldo pendiente
  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, 'M1']);
  await db.query(
    "INSERT INTO table_sessions (public_id, tenant_id, branch_id, table_id, status, total_amount, paid_amount, closed_at) VALUES ('01RECONCFORCECLOSEDAAAA', ?, ?, ?, 'FORCE_CLOSED', 3000.00, 1000.00, NOW())",
    [T, ctx.branchId, tb.insertId]
  );

  // 4) devolución pendiente (excedente sin resolver)
  const { id: paidPaymentId } = await payRepo.createPayment(T, { branchId: ctx.branchId, kind: 'ORDER', provider: 'MERCADOPAGO', amount: '500.00' });
  await payRepo.setPaymentStatus(T, paidPaymentId, 'APPROVED');
  await payRepo.createRefund(T, paidPaymentId, { amount: '500.00', status: 'PENDING', reason: 'excedente' });
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('detecta un pago PENDING viejo sin resolver', async () => {
  const r = await paySvc.getReconciliation(T, ctx.branchId, { staleMinutes: 30 });
  assert.equal(r.stalePending.length, 1);
  assert.equal(r.stalePending[0].amount, '1000.00');
});

test('detecta un pedido de mostrador entregado sin cobrar', async () => {
  const r = await paySvc.getReconciliation(T, ctx.branchId, { staleMinutes: 30 });
  assert.equal(r.unpaidCounterOrders.length, 1);
  assert.equal(r.unpaidCounterOrders[0].total, '2000.00');
});

test('detecta una mesa cerrada por la fuerza con saldo pendiente', async () => {
  const r = await paySvc.getReconciliation(T, ctx.branchId, { staleMinutes: 30 });
  assert.equal(r.forceClosedWithBalance.length, 1);
  assert.equal(r.forceClosedWithBalance[0].total_amount, '3000.00');
  assert.equal(r.forceClosedWithBalance[0].paid_amount, '1000.00');
});

test('detecta una devolución pendiente (excedente sin resolver)', async () => {
  const r = await paySvc.getReconciliation(T, ctx.branchId, { staleMinutes: 30 });
  assert.equal(r.pendingRefunds.length, 1);
  assert.equal(r.pendingRefunds[0].amount, '500.00');
});

test('con una ventana chica (staleMinutes alto) el pago PENDING deja de figurar', async () => {
  const r = await paySvc.getReconciliation(T, ctx.branchId, { staleMinutes: 200 });
  assert.equal(r.stalePending.length, 0);
});
