// Falla 4 — cobro en efectivo sin caja: la UI nunca mandaba `cashSessionId`
// y la venta quedaba fuera del arqueo. Ahora: sin caja abierta en la
// sucursal no se cobra en efectivo; sin `cashSessionId` se usa la única
// caja abierta; con varias hay que elegir; una caja de otra sucursal se
// rechaza. MercadoPago no pasa por la caja.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const paySvc = require('../src/modules/payments/payments.service');
const cashSvc = require('../src/modules/cash/cash.service');

const T = 998965;
const staff = { actorId: null, req: {} };
let ctx = {};
let n = 0;

async function newTable(branchId) {
  n += 1;
  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, branchId, `C${n}`]);
  const [ts] = await db.query(
    "INSERT INTO table_sessions (public_id, tenant_id, branch_id, table_id, status, total_amount, paid_amount) VALUES (?, ?, ?, ?, 'BILL_REQUESTED', 3000.00, 0.00)",
    [`01CASHREQUIRED${n}`.padEnd(26, 'A'), T, branchId, tb.insertId]
  );
  return ts.insertId;
}
async function newCounterOrder(branchId) {
  n += 1;
  const [o] = await db.query(
    "INSERT INTO orders (public_id, tenant_id, branch_id, channel, status, total, currency) VALUES (?, ?, ?, 'COUNTER', 'CONFIRMED', 1500.00, 'ARS')",
    [`01CASHREQORDER${n}`.padEnd(26, 'A'), T, branchId]
  );
  return o.insertId;
}
const saleCount = async (cashSessionId) =>
  (await db.query("SELECT COUNT(*) n FROM cash_movements WHERE tenant_id = ? AND cash_session_id = ? AND type = 'SALE'", [T, cashSessionId]))[0][0].n;
const rejectsWith = (code) => (e) => { assert.equal(e.code, code); return true; };

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Caja requerida', 'caja-requerida-test']);
  const [a] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'a', 'A']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'b', 'B']);
  ctx.branchA = a.insertId;
  ctx.branchB = b.insertId;
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('sin caja abierta en la sucursal: el cobro en efectivo se rechaza y no queda nada cobrado', async () => {
  const sessionId = await newTable(ctx.branchA);
  await assert.rejects(() => paySvc.chargeSession(T, sessionId, { mode: 'GROUP', provider: 'CASH' }, staff), rejectsWith('CASH_SESSION_REQUIRED'));
  await assert.rejects(() => paySvc.splitEqual(T, sessionId, 2, staff), rejectsWith('CASH_SESSION_REQUIRED'));
  const orderId = await newCounterOrder(ctx.branchA);
  await assert.rejects(() => paySvc.chargeOrder(T, orderId, { provider: 'CASH' }, staff), rejectsWith('CASH_SESSION_REQUIRED'));
  const [[{ c }]] = await db.query('SELECT COUNT(*) c FROM payments WHERE tenant_id = ?', [T]);
  assert.equal(c, 0);
});

test('una sola caja abierta y sin cashSessionId: la venta entra a esa caja (mesa, división y mostrador)', async () => {
  const reg = await cashSvc.createRegister(T, ctx.branchA, { code: 'a1', name: 'A1' }, {});
  ctx.cashA1 = (await cashSvc.openRegister(T, reg.id, '0.00', {})).id;

  const p = await paySvc.chargeSession(T, await newTable(ctx.branchA), { mode: 'GROUP', provider: 'CASH' }, staff);
  assert.equal(p.status, 'APPROVED');
  assert.equal(await saleCount(ctx.cashA1), 1);

  await paySvc.splitEqual(T, await newTable(ctx.branchA), 3, staff);
  assert.equal(await saleCount(ctx.cashA1), 4);

  await paySvc.chargeOrder(T, await newCounterOrder(ctx.branchA), { provider: 'CASH' }, staff);
  assert.equal(await saleCount(ctx.cashA1), 5);

  const session = await cashSvc.getSession(T, ctx.cashA1);
  assert.equal(session.currentBalance, '7500.00'); // 3000 + 3000 + 1500
});

test('una caja de otra sucursal se rechaza', async () => {
  const reg = await cashSvc.createRegister(T, ctx.branchB, { code: 'b1', name: 'B1' }, {});
  ctx.cashB1 = (await cashSvc.openRegister(T, reg.id, '0.00', {})).id;
  const sessionId = await newTable(ctx.branchA);
  await assert.rejects(
    () => paySvc.chargeSession(T, sessionId, { mode: 'GROUP', provider: 'CASH', cashSessionId: ctx.cashB1 }, staff),
    rejectsWith('VALIDATION')
  );
  assert.equal(await saleCount(ctx.cashB1), 0);
});

test('varias cajas abiertas: sin elegir se rechaza; eligiendo, la venta va a la elegida', async () => {
  const reg = await cashSvc.createRegister(T, ctx.branchA, { code: 'a2', name: 'A2' }, {});
  const cashA2 = (await cashSvc.openRegister(T, reg.id, '0.00', {})).id;
  const sessionId = await newTable(ctx.branchA);
  await assert.rejects(() => paySvc.chargeSession(T, sessionId, { mode: 'GROUP', provider: 'CASH' }, staff), rejectsWith('CASH_SESSION_AMBIGUOUS'));
  await paySvc.chargeSession(T, sessionId, { mode: 'GROUP', provider: 'CASH', cashSessionId: cashA2 }, staff);
  assert.equal(await saleCount(cashA2), 1);
});
