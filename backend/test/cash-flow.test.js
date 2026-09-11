// Ciclo de caja — apertura, ventas en efectivo vinculadas, movimiento
// manual, cierre con arqueo, y cómo interactúa con las devoluciones. Sin
// Firebase (service directo, mismo patrón que orders/payments-flow).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');
const cashSvc = require('../src/modules/cash/cash.service');

const T = 998950;
let ctx = {};
const staff = { actorId: null, req: {} };

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Caja', 'caja-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '5000.00']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('crear una caja y abrirla; un 2º intento de abrir la misma caja -> rechazado', async () => {
  const register = await cashSvc.createRegister(T, ctx.branchId, { code: 'caja1', name: 'Caja 1' }, {});
  ctx.registerId = register.id;
  const session = await cashSvc.openRegister(T, register.id, '1000.00', {});
  assert.equal(session.status, 'OPEN');
  assert.equal(session.opening_amount, '1000.00');
  ctx.cashSessionId = session.id;

  await assert.rejects(() => cashSvc.openRegister(T, register.id, '500.00', {}), (e) => { assert.equal(e.code, 'CONFLICT'); return true; });
});

test('un cobro en efectivo vinculado a la caja deja un movimiento SALE', async () => {
  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, 'M1']);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, tb.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: 'X' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  ctx.tableSessionId = sess.id;
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sess.id, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, { kind: 'guest' });
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });

  const payment = await paySvc.chargeSession(T, ctx.tableSessionId, { mode: 'GROUP', provider: 'CASH', cashSessionId: ctx.cashSessionId }, staff);
  assert.equal(payment.status, 'APPROVED');
  ctx.paymentId = (await db.query('SELECT id FROM payments WHERE public_id = ?', [payment.public_id]))[0][0].id;

  const [[mv]] = await db.query("SELECT amount, type, payment_id FROM cash_movements WHERE tenant_id = ? AND cash_session_id = ? AND type='SALE'", [T, ctx.cashSessionId]);
  assert.equal(mv.amount, '5000.00');
  assert.equal(mv.payment_id, ctx.paymentId);

  const session = await cashSvc.getSession(T, ctx.cashSessionId);
  assert.equal(session.currentBalance, '6000.00'); // 1000 apertura + 5000 venta
});

test('un movimiento manual (retiro) resta del saldo actual', async () => {
  await cashSvc.addMovement(T, ctx.cashSessionId, { type: 'PAYOUT', amount: '200.00', reason: 'compra de servilletas' }, {});
  const session = await cashSvc.getSession(T, ctx.cashSessionId);
  assert.equal(session.currentBalance, '5800.00');
});

test('cerrar la caja calcula lo esperado y la diferencia del arqueo', async () => {
  const closed = await cashSvc.closeRegisterSession(T, ctx.cashSessionId, '5800.00', {});
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.expected_amount, '5800.00');
  assert.equal(closed.difference, '0.00');

  await assert.rejects(() => cashSvc.addMovement(T, ctx.cashSessionId, { type: 'DEPOSIT', amount: '10.00', reason: 'x' }, {}));
  await assert.rejects(() => cashSvc.closeRegisterSession(T, ctx.cashSessionId, '5800.00', {}));
});

test('una devolución sobre una caja ya cerrada NO le toca el ledger (la caja no se reabre sola)', async () => {
  const [[before1]] = await db.query('SELECT COUNT(*) n FROM cash_movements WHERE cash_session_id = ?', [ctx.cashSessionId]);
  await paySvc.refundPayment(T, ctx.paymentId, { amount: '500.00', reason: 'reclamo del cliente' }, staff);
  const [[after1]] = await db.query('SELECT COUNT(*) n FROM cash_movements WHERE cash_session_id = ?', [ctx.cashSessionId]);
  assert.equal(before1.n, after1.n, 'no se agregó ningún movimiento a la caja ya cerrada');
});

test('arqueo con diferencia: cerrar con un monto distinto al esperado la deja registrada', async () => {
  const register2 = await cashSvc.createRegister(T, ctx.branchId, { code: 'caja2', name: 'Caja 2' }, {});
  const session2 = await cashSvc.openRegister(T, register2.id, '2000.00', {});
  const closed = await cashSvc.closeRegisterSession(T, session2.id, '1950.00', {});
  assert.equal(closed.expected_amount, '2000.00');
  assert.equal(closed.difference, '-50.00');
});
