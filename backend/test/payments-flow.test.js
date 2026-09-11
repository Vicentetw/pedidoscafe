// Circuito de pagos — sin Firebase. Ejercita el service directo (como
// orders-flow.test.js) para los cobros de staff/efectivo, y la superficie
// del comensal por HTTP (/api/session/payments) para el online.
// Cubre los casos obligatorios 2 y 7.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');

const T = 998910;
let srv;
let ctx = {};
const staff = { actorId: null, req: {} };

async function newSession(displayName) {
  const r = await tablesSvc.startSession(ctx.qr, { displayName }, {});
  return r; // { session, participant, ... }
}
async function orderFor(sessionPublicId, participantIdInternal, amount1, qty = 1) {
  // usamos el service directo con channel TABLE (mismo que crea la superficie /api/session)
  const s = (await db.query('SELECT id, tenant_id, branch_id FROM table_sessions WHERE public_id = ?', [sessionPublicId]))[0][0];
  const o = await orderSvc.createOrder(T, { branchId: s.branch_id, sessionId: s.id, participantId: participantIdInternal, channel: 'TABLE' }, { kind: 'guest', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty }, { kind: 'guest' });
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });
  return s.id;
}

before(async () => {
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Pagos flow', 'pagos-flow-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'cafe', 'Café', '5000.00']);
});

after(async () => {
  await resetTenant(T);
  await srv.close();
  await db.end().catch(() => {});
});

async function freshTable(code) {
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, code]);
  return { id: t.insertId, qr: await tablesRepo.createQrToken(T, ctx.branchId, t.insertId) };
}

test('CASO OBLIGATORIO 7: tres personas pagan parcialmente -> la cuenta queda correctamente saldada', async () => {
  const table = await freshTable('P7');
  ctx.qr = table.qr;
  const juan = await newSession('Juan');
  const [[juanRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [juan.participant.id]);
  const sessId = await orderFor(juan.session.id, juanRow.id, 5000, 2); // Juan: 10000

  const mariaRes = await tablesSvc.startSession(table.qr, { displayName: 'María' }, {});
  const [[mariaRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [mariaRes.participant.id]);
  await orderFor(mariaRes.session.id, mariaRow.id, 5000, 2); // María: 10000

  const pedroRes = await tablesSvc.startSession(table.qr, { displayName: 'Pedro' }, {});
  const [[pedroRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [pedroRes.participant.id]);
  await orderFor(pedroRes.session.id, pedroRow.id, 5000, 2); // Pedro: 10000

  const [[sess]] = await db.query('SELECT total_amount FROM table_sessions WHERE id = ?', [sessId]);
  assert.equal(sess.total_amount, '30000.00');

  for (const publicId of [juan.participant.id, mariaRes.participant.id, pedroRes.participant.id]) {
    const p = await paySvc.chargeSession(T, sessId, { mode: 'INDIVIDUAL', participantId: publicId, provider: 'CASH' }, staff);
    assert.equal(p.status, 'APPROVED');
    assert.equal(p.amount, '10000.00');
  }

  const [[after1]] = await db.query('SELECT paid_amount, total_amount, status FROM table_sessions WHERE id = ?', [sessId]);
  assert.equal(after1.paid_amount, after1.total_amount);
  assert.equal(after1.status, 'PAID');
  ctx.session7 = sessId;

  // Bug real de la aceptación: un cobro INDIVIDUAL sólo tocaba el total de
  // la mesa, nunca el payment_status del pedido de esa persona — quedaba
  // UNPAID para siempre aunque ya lo hubiera pagado.
  const [orderRows] = await db.query('SELECT payment_status FROM orders WHERE tenant_id = ? AND session_id = ?', [T, sessId]);
  assert.ok(orderRows.length >= 3);
  assert.ok(orderRows.every((o) => o.payment_status === 'PAID'), 'los 3 pedidos quedan marcados PAID tras pagar cada uno su parte');
});

test('un 4º intento de pago individual sobre una cuenta ya saldada -> rechazado', async () => {
  const [[p]] = await db.query('SELECT public_id FROM session_participants WHERE tenant_id = ? AND session_id = ? LIMIT 1', [T, ctx.session7]);
  await assert.rejects(
    () => paySvc.chargeSession(T, ctx.session7, { mode: 'INDIVIDUAL', participantId: p.public_id, provider: 'CASH' }, staff),
    (err) => { assert.equal(err.code, 'ALREADY_PAID'); return true; }
  );
});

test('CASO OBLIGATORIO 2: dos cobros GRUPALES simultáneos sobre la misma mesa -> nunca se cobra dos veces', async () => {
  const table = await freshTable('P2');
  const j = await tablesSvc.startSession(table.qr, { displayName: 'Solo' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [j.participant.id]);
  const sessId = (await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [j.session.id]))[0][0].id;
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sessId, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, { kind: 'guest' }); // 5000
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });

  const [rA, rB] = await Promise.allSettled([
    paySvc.chargeSession(T, sessId, { mode: 'GROUP', provider: 'CASH' }, staff),
    paySvc.chargeSession(T, sessId, { mode: 'GROUP', provider: 'CASH' }, staff),
  ]);
  const results = [rA, rB];
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'sólo uno de los dos cobros se concreta');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'ALREADY_PAID');
  assert.equal(fulfilled[0].value.amount, '5000.00');

  const [[sess]] = await db.query('SELECT paid_amount, total_amount, status FROM table_sessions WHERE id = ?', [sessId]);
  assert.equal(sess.paid_amount, '5000.00');
  assert.equal(sess.paid_amount, sess.total_amount, 'NUNCA se pasa del total (no hay doble cobro)');
  assert.equal(sess.status, 'PAID');
  ctx.session2 = sessId;
});

test('dividir en partes iguales (efectivo): la suma de las partes == el total, la mesa queda saldada', async () => {
  const table = await freshTable('SPLIT');
  const j = await tablesSvc.startSession(table.qr, { displayName: 'X' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [j.participant.id]);
  const sessId = (await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [j.session.id]))[0][0].id;
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sessId, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 2 }, { kind: 'guest' }); // 10000
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });

  const payments = await paySvc.splitEqual(T, sessId, 3, staff);
  assert.equal(payments.length, 3);
  const sum = payments.reduce((a, p) => a + Number(p.amount), 0);
  assert.equal(sum.toFixed(2), '10000.00');
  const [[sess]] = await db.query('SELECT paid_amount, status FROM table_sessions WHERE id = ?', [sessId]);
  assert.equal(sess.paid_amount, '10000.00');
  assert.equal(sess.status, 'PAID');
});

// Bug real encontrado en aceptación: una mesa YA saldada (PAID) que sigue
// pidiendo (ej. un postre después de pagar) quedaba mostrando "saldada"
// para siempre — recomputeSessionTotal subía total_amount pero nada volvía
// a bajar el status de PAID. PAID -> PARTIALLY_PAID es una transición
// válida de la máquina de estados justo para esto.
test('una mesa ya PAID que pide algo más dejar de figurar como saldada (vuelve a PARTIALLY_PAID)', async () => {
  const table = await freshTable('POSTPAID');
  const j = await tablesSvc.startSession(table.qr, { displayName: 'Tarde' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [j.participant.id]);
  const sessId = (await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [j.session.id]))[0][0].id;

  const o1 = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sessId, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o1.id, { productCode: 'cafe', qty: 1 }, { kind: 'guest' }); // 5000
  await orderSvc.submitOrder(T, o1.id, { kind: 'guest' });
  await paySvc.chargeSession(T, sessId, { mode: 'GROUP', provider: 'CASH' }, staff);
  let [[sess]] = await db.query('SELECT status, paid_amount, total_amount FROM table_sessions WHERE id = ?', [sessId]);
  assert.equal(sess.status, 'PAID');

  // pide una gaseosa más, después de haber pagado
  const o2 = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sessId, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o2.id, { productCode: 'cafe', qty: 1 }, { kind: 'guest' });
  await orderSvc.submitOrder(T, o2.id, { kind: 'guest' }); // dispara recomputeSessionTotal

  [[sess]] = await db.query('SELECT status, paid_amount, total_amount FROM table_sessions WHERE id = ?', [sessId]);
  assert.equal(sess.total_amount, '10000.00');
  assert.equal(sess.paid_amount, '5000.00');
  assert.equal(sess.status, 'PARTIALLY_PAID', 'ya no puede seguir diciendo "saldada": hay $5000 de saldo real');
});

test('devolución parcial: baja el saldo pagado y la mesa vuelve a PARTIALLY_PAID', async () => {
  const [[payment]] = await db.query("SELECT id FROM payments WHERE tenant_id = ? AND session_id = ? AND status = 'APPROVED' LIMIT 1", [T, ctx.session2]);
  const refunded = await paySvc.refundPayment(T, payment.id, { amount: '2000.00', reason: 'se cobró de más' }, staff);
  assert.equal(refunded.status, 'PARTIALLY_REFUNDED');
  const [[sess]] = await db.query('SELECT paid_amount, status FROM table_sessions WHERE id = ?', [ctx.session2]);
  assert.equal(sess.paid_amount, '3000.00');
  assert.equal(sess.status, 'PARTIALLY_PAID');
});

test('cobro de un pedido de mostrador (sin mesa): efectivo lo paga directo, no se puede cobrar dos veces', async () => {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, { kind: 'staff', actorId: null });
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, { kind: 'staff' });
  await orderSvc.submitOrder(T, o.id, { kind: 'staff', actorId: null });

  const p = await paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff);
  assert.equal(p.status, 'APPROVED');
  const [[after1]] = await db.query('SELECT payment_status FROM orders WHERE id = ?', [o.id]);
  assert.equal(after1.payment_status, 'PAID');

  await assert.rejects(
    () => paySvc.chargeOrder(T, o.id, { provider: 'CASH' }, staff),
    (err) => { assert.equal(err.code, 'ALREADY_PAID'); return true; }
  );
});

test('el comensal SÓLO puede pagar online — sin MP_ACCESS_TOKEN configurado, el intento falla con MP_NOT_CONFIGURED (nunca CASH)', async () => {
  const table = await freshTable('GUEST');
  const j = await tablesSvc.startSession(table.qr, { displayName: 'Guest' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [j.participant.id]);
  const sessId = (await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [j.session.id]))[0][0].id;
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sessId, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, { kind: 'guest' });
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });

  const res = await fetch(`${srv.baseUrl}/api/session/payments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${j.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'GROUP', provider: 'CASH' }), // "provider" inyectado -> el schema lo ignora
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'MP_NOT_CONFIGURED');

  const [[payment]] = await db.query("SELECT status, provider FROM payments WHERE tenant_id = ? AND session_id = ? ORDER BY id DESC LIMIT 1", [T, sessId]);
  assert.equal(payment.provider, 'MERCADOPAGO', 'el proveedor SIEMPRE es el que decide el servidor, no el body');
  assert.equal(payment.status, 'CANCELLED');
});

// "Verificar pago" manual (pedido en la aceptación: sin URL pública para
// el webhook en desarrollo local, hace falta una forma de confirmar un
// cobro de MercadoPago sin depender de que MP nos avise solo). Sin
// MP_ACCESS_TOKEN en este entorno no se puede probar el camino feliz
// completo (encontrar el pago real en MercadoPago) — mismo límite honesto
// que el resto de la integración desde la Fase 6 — pero sí toda la lógica
// de guardas alrededor.
test('checkPendingMpPayment: rechaza un pago que no es de MercadoPago', async () => {
  const table = await freshTable('CHKCASH');
  const j = await tablesSvc.startSession(table.qr, { displayName: 'X' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [j.participant.id]);
  const sessId = (await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [j.session.id]))[0][0].id;
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sessId, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, { kind: 'guest' });
  await orderSvc.submitOrder(T, o.id, { kind: 'guest' });
  const cashPayment = await paySvc.chargeSession(T, sessId, { mode: 'GROUP', provider: 'CASH' }, staff);

  await assert.rejects(() => paySvc.checkPendingMpPayment(T, cashPayment.id, staff), (err) => {
    assert.match(err.message, /no es de MercadoPago/);
    return true;
  });
});

test('checkPendingMpPayment: un pago ya resuelto no vuelve a consultar MercadoPago (ni falla sin credenciales)', async () => {
  // Fixture directo por SQL: no se puede crear un pago MERCADOPAGO real sin
  // MP_ACCESS_TOKEN (createCheckout tira MP_NOT_CONFIGURED antes de nada).
  const { ulid } = require('ulid');
  const [r] = await db.query(
    `INSERT INTO payments (public_id, tenant_id, branch_id, kind, provider, amount, currency, status, external_reference)
     VALUES (?, ?, ?, 'ORDER', 'MERCADOPAGO', '100.00', 'ARS', 'APPROVED', ?)`,
    [ulid(), T, ctx.branchId, `test-ref-${Date.now()}`]
  );
  const result = await paySvc.checkPendingMpPayment(T, r.insertId, staff);
  assert.equal(result.checked, false, 'ya estaba APPROVED, no PENDING — ni intenta llamar a MercadoPago');
  assert.equal(result.status, 'APPROVED');
});

test('checkPendingMpPayment: un pago PENDING real sin MP_ACCESS_TOKEN da MP_NOT_CONFIGURED, no un error críptico', async () => {
  const { ulid } = require('ulid');
  const [r] = await db.query(
    `INSERT INTO payments (public_id, tenant_id, branch_id, kind, provider, amount, currency, status, external_reference)
     VALUES (?, ?, ?, 'ORDER', 'MERCADOPAGO', '100.00', 'ARS', 'PENDING', ?)`,
    [ulid(), T, ctx.branchId, `test-ref-pending-${Date.now()}`]
  );
  await assert.rejects(() => paySvc.checkPendingMpPayment(T, r.insertId, staff), (err) => {
    assert.equal(err.code, 'MP_NOT_CONFIGURED');
    return true;
  });
});

test('GET /api/session/payments/balance devuelve el saldo de la mesa', async () => {
  const table = await freshTable('BAL');
  const j = await tablesSvc.startSession(table.qr, { displayName: 'Bal' }, {});
  const res = await fetch(`${srv.baseUrl}/api/session/payments/balance`, { headers: { Authorization: `Bearer ${j.token}` } });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.total, '0.00');
  assert.equal(b.remaining, '0.00');
});
