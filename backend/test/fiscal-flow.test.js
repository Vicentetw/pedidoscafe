// Comprobantes — ticket no fiscal (sin AFIP configurado, caso normal de
// esta fase) + la caída controlada a ticket cuando se pide un tipo real
// sin CUIT/certificado. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');
const fiscalSvc = require('../src/modules/fiscal/fiscal.service');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');

const T = 998980;
let ctx = {};
const staff = { actorId: null, req: {} };

async function counterOrderPaid(qty = 1) {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty }, { kind: 'staff' });
  await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);
  return o.id;
}

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Fiscal', 'fiscal-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1210.00']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('sin AFIP configurado, emitir un comprobante da un TICKET no fiscal numerado', async () => {
  const orderId = await counterOrderPaid();
  const doc = await fiscalSvc.issueForOrder(T, orderId, {}, staff);
  assert.equal(doc.doc_type, 'TICKET');
  assert.equal(doc.number, 1);
  assert.equal(doc.status, 'ISSUED');
  assert.equal(doc.total_amount, '1210.00');
  assert.equal(doc.items.length, 1);
  ctx.firstOrderId = orderId;
});

test('emitir dos veces para el mismo pedido devuelve el MISMO comprobante (idempotente)', async () => {
  const again = await fiscalSvc.issueForOrder(T, ctx.firstOrderId, {}, staff);
  const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM fiscal_documents WHERE tenant_id = ? AND order_id = ?', [T, ctx.firstOrderId]);
  assert.equal(n, 1);
  assert.equal(again.number, 1);
});

test('no se puede emitir un comprobante para un pedido sin pagar', async () => {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });
  await assert.rejects(() => fiscalSvc.issueForOrder(T, o.id, {}, staff));
});

test('la numeración es correlativa dentro de la misma sucursal', async () => {
  const orderId2 = await counterOrderPaid();
  const doc2 = await fiscalSvc.issueForOrder(T, orderId2, {}, staff);
  assert.equal(doc2.number, 2);
});

test('con una alícuota por defecto (21%), el neto + IVA suman el total', async () => {
  await fiscalSvc.createTaxRate(T, { code: 'iva21', name: 'IVA 21%', rate: 21, isDefault: true }, {});
  const orderId3 = await counterOrderPaid();
  const doc = await fiscalSvc.issueForOrder(T, orderId3, {}, staff);
  assert.equal(doc.net_amount, '1000.00');
  assert.equal(doc.tax_amount, '210.00');
  assert.equal((Number(doc.net_amount) + Number(doc.tax_amount)).toFixed(2), doc.total_amount);
});

test('emitir un comprobante para una mesa saldada toma los ítems de todos sus pedidos', async () => {
  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, 'M1']);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, tb.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: 'X' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sess.id, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 2 }, { kind: 'guest' });
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });
  await paySvc.chargeSession(T, sess.id, { mode: 'GROUP', provider: 'CASH' }, staff);

  const doc = await fiscalSvc.issueForSession(T, sess.id, {}, staff);
  assert.equal(doc.total_amount, '2420.00');
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].qty, '2.000');
});

test('pedir un tipo fiscal real sin AFIP configurado cae a TICKET, marcado', async () => {
  await fiscalSvc.setConfig(T, ctx.branchId, { cuit: '20111111112', pointOfSaleNo: 1, environment: 'HOMOLOGACION', defaultDocType: 'B' }, {});
  const orderId4 = await counterOrderPaid();
  const doc = await fiscalSvc.issueForOrder(T, orderId4, {}, staff);
  assert.equal(doc.doc_type, 'TICKET', 'cae a ticket no fiscal — AFIP real no está implementado');
  assert.equal(doc.fellBackToTicket, true);
});
