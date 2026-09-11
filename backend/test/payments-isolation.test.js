// Aislamiento entre empresas — pagos. Dos empresas con mesa/pedido
// equivalentes; cobrar en A nunca toca el saldo ni los pagos de B.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');
const payRepo = require('../src/modules/payments/payments.repository');

const TA = 998930;
const TB = 998931;
let a = {};
let b = {};
const staff = { actorId: null, req: {} };

async function seed(tid, label, price) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Pay ${label}`, `pay-${label.toLowerCase()}-iso`]);
  const [br] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', `C ${label}`]);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [tid, c.insertId, 'x', `X ${label}`, price]);
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [tid, br.insertId, 'M1']);
  const qr = await tablesRepo.createQrToken(tid, br.insertId, t.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: label }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  const o = await orderSvc.createOrder(tid, { branchId: br.insertId, sessionId: sess.id, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(tid, o.id, { productCode: 'x', qty: 1 }, { kind: 'guest' });
  await orderSvc.submitOrder(tid, o.id, { kind: 'guest' });
  return { branchId: br.insertId, sessionId: sess.id };
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

test('cobrar la mesa de A no toca el saldo de B', async () => {
  const p = await paySvc.chargeSession(TA, a.sessionId, { mode: 'GROUP', provider: 'CASH' }, staff);
  assert.equal(p.amount, '1000.00');

  const [[sa]] = await db.query('SELECT paid_amount FROM table_sessions WHERE id = ?', [a.sessionId]);
  const [[sb]] = await db.query('SELECT paid_amount FROM table_sessions WHERE id = ?', [b.sessionId]);
  assert.equal(sa.paid_amount, '1000.00');
  assert.equal(sb.paid_amount, '0.00', 'B intacto');
});

test('B todavía puede cobrar su propia mesa con su propio total', async () => {
  const p = await paySvc.chargeSession(TB, b.sessionId, { mode: 'GROUP', provider: 'CASH' }, staff);
  assert.equal(p.amount, '2000.00');
});

test('listPayments(A) sólo trae pagos de A', async () => {
  const rows = await payRepo.listPayments(TA, {});
  assert.ok(rows.length >= 1 && rows.every((r) => r.tenant_id === TA));
});

test('getPayment(A, <pago de B>) -> no lo encuentra', async () => {
  const [[payB]] = await db.query('SELECT id FROM payments WHERE tenant_id = ?', [TB]);
  await assert.rejects(() => paySvc.getPayment(TA, payB.id));
});
