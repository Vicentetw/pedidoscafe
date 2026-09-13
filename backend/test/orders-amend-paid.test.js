// "Modificar la orden [ya confirmada] y cargar la diferencia" — pedido
// explícito de la aceptación. Antes, CUALQUIER pedido no-DRAFT era
// intocable para cualquiera; ahora staff con orders:amend_paid puede
// seguir agregando/sacando ítems mientras nada se empezó a preparar
// (CONFIRMED/QUEUED), y el total de la mesa se recalcula solo — de ahí
// en más, el cobro/devolución de la diferencia ya lo cubre el circuito
// de pagos existente (Caja ya refleja el saldo nuevo).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const kitchenSvc = require('../src/modules/orders/kitchen.service');

const T = 998480;
let ctx = {};
const guest = { kind: 'guest', actorId: null };
const staffNoPerm = { kind: 'staff', actorId: null, canAmendPaid: false };
const staffWithPerm = { kind: 'staff', actorId: null, canAmendPaid: true };

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Amend Paid', 'amend-paid-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'cafe', 'Café', '1000.00']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'medialuna', 'Medialuna', '500.00']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

let clientN = 0;
async function freshOrder() {
  clientN += 1;
  // Mesa nueva por pedido: si reusara la misma, el total de la SESIÓN
  // arrastraría los pedidos de los tests anteriores (recomputeSessionTotal
  // suma TODOS los pedidos activos de la sesión, no sólo el de este test).
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, `AP${clientN}`]);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, t.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: `Cli${clientN}` }, {});
  const [[p]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sess.id, participantId: p.id, channel: 'TABLE' }, guest);
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, guest);
  const submitted = await orderSvc.submitOrder(T, o.id, guest); // -> QUEUED (sin estaciones configuradas)
  return { orderId: o.id, sessionId: sess.id, submitted };
}

test('sin orders:amend_paid, staff NO puede agregar a un pedido ya confirmado -> 403', async () => {
  const { orderId } = await freshOrder();
  await assert.rejects(
    () => orderSvc.addItem(T, orderId, { productCode: 'medialuna', qty: 1 }, staffNoPerm),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('el comensal tampoco puede (mismo 409 ORDER_NOT_EDITABLE de siempre)', async () => {
  const { orderId } = await freshOrder();
  await assert.rejects(
    () => orderSvc.addItem(T, orderId, { productCode: 'medialuna', qty: 1 }, guest),
    (err) => { assert.equal(err.status, 409); assert.equal(err.code, 'ORDER_NOT_EDITABLE'); return true; }
  );
});

test('con orders:amend_paid, staff agrega un ítem: total del pedido Y de la mesa suben, y sale un ticket nuevo', async () => {
  const { orderId, sessionId } = await freshOrder();
  const before = await orderSvc.getOrder(T, orderId);
  assert.equal(before.total, '1000.00');

  const [[ticketsBefore]] = await db.query('SELECT COUNT(*) n FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, orderId]);

  const after = await orderSvc.addItem(T, orderId, { productCode: 'medialuna', qty: 1 }, staffWithPerm);
  assert.equal(after.total, '1500.00');

  const [[sess]] = await db.query('SELECT total_amount FROM table_sessions WHERE id = ?', [sessionId]);
  assert.equal(sess.total_amount, '1500.00', 'el saldo de la mesa refleja el agregado — Caja ya lo cobra solo');

  const [[ticketsAfter]] = await db.query('SELECT COUNT(*) n FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, orderId]);
  assert.equal(ticketsAfter.n, ticketsBefore.n + 1, 'cocina recibe un ticket de seguimiento con el ítem nuevo');
});

test('con orders:amend_paid, staff saca un ítem: total baja y su kitchen_ticket_item desaparece (cascade)', async () => {
  const { orderId, sessionId } = await freshOrder();
  const withExtra = await orderSvc.addItem(T, orderId, { productCode: 'medialuna', qty: 1 }, staffWithPerm);
  const extraItem = withExtra.items.find((i) => i.name_snapshot === 'Medialuna');
  const [[kti]] = await db.query('SELECT id FROM kitchen_ticket_items WHERE order_item_id = ?', [extraItem.id]);
  assert.ok(kti, 'el ítem nuevo sí generó su kitchen_ticket_item');

  const after = await orderSvc.removeItem(T, orderId, extraItem.id, staffWithPerm);
  assert.equal(after.total, '1000.00');

  const [[sess]] = await db.query('SELECT total_amount FROM table_sessions WHERE id = ?', [sessionId]);
  assert.equal(sess.total_amount, '1000.00');

  const [[ktiAfter]] = await db.query('SELECT id FROM kitchen_ticket_items WHERE order_item_id = ?', [extraItem.id]);
  assert.equal(ktiAfter, undefined, 'el DELETE CASCADE se lo llevó puesto — cocina no lo ve más');
});

test('una vez PREPARING, ni siquiera con orders:amend_paid se puede tocar (cancelá y cargá uno nuevo)', async () => {
  const { orderId } = await freshOrder();
  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, orderId]);
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // QUEUED -> PREPARING

  await assert.rejects(
    () => orderSvc.addItem(T, orderId, { productCode: 'medialuna', qty: 1 }, staffWithPerm),
    (err) => { assert.equal(err.status, 409); assert.equal(err.code, 'ORDER_NOT_EDITABLE'); return true; }
  );
});

// Bug real reportado en la aceptación: "no podía cerrar la mesa aunque
// el saldo estaba en $0". Causa real: sacar el único ítem de un pedido
// confirmado deja total_amount=0 y paid_amount=0 (nunca se pagó nada) —
// syncSessionStatus no tiene a dónde sincronizar un saldo "0 y 0" (ni
// PAID ni PARTIALLY_PAID aplican), así que el status de la mesa se queda
// en SERVING — un status que la máquina de estados NO dejaba pasar
// directo a CLOSED, aunque closeSession ya había confirmado que la plata
// está saldada. Cubre el fix en tableSession.stateMachine.js.
test('sacar el único ítem deja la mesa en $0/$0 — igual se puede cerrar (bug real)', async () => {
  const { orderId, sessionId } = await freshOrder();
  const [[sess1]] = await db.query('SELECT status FROM table_sessions WHERE id = ?', [sessionId]);
  assert.equal(sess1.status, 'SERVING');

  const order = await orderSvc.getOrder(T, orderId);
  const onlyItem = order.items[0];
  await orderSvc.removeItem(T, orderId, onlyItem.id, staffWithPerm);

  const [[sess2]] = await db.query('SELECT status, total_amount, paid_amount FROM table_sessions WHERE id = ?', [sessionId]);
  assert.equal(sess2.total_amount, '0.00');
  assert.equal(sess2.paid_amount, '0.00');
  // Antes del fix, sess2.status quedaba en 'SERVING' y esto tiraba
  // INVALID_SESSION_TRANSITION — ahora cierra sin problema.
  const closed = await tablesSvc.closeSession(T, sessionId, {});
  assert.equal(closed.status, 'CLOSED');
});
