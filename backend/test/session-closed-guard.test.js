// Falla 1 de la auditoría del 2026-10-30: un table_session_token seguía
// operando con la mesa ya cerrada (el pedido llegaba a cocina y nadie lo
// cobraba) o después de que sacaran a esa persona de la mesa. Se prueba por
// HTTP la superficie del comensal; lo de staff va contra el service, igual
// que el resto de la suite cuando no hace falta Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { openCash } = require('./helpers/cash');
const { startTestServer } = require('./helpers/server');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');

const T = 998380;
let srv;
let ctx = {};
let tableN = 0;
const staff = { kind: 'staff', actorId: null, canAmendPaid: true, canCancelAfterPrep: true };

before(async () => {
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Guard', 'session-guard-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  await openCash(T, b.insertId);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'cafe', 'Café', '1000.00']);
});

after(async () => {
  await resetTenant(T);
  await srv.close();
  await db.end().catch(() => {});
});

async function g(token, method, path, body) {
  return fetch(`${srv.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function newTable() {
  tableN += 1;
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, `G${tableN}`]);
  return tablesRepo.createQrToken(T, ctx.branchId, t.insertId);
}
async function join(qr, displayName) {
  const res = await fetch(`${srv.baseUrl}/api/public/table-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken: qr, displayName }),
  });
  assert.equal(res.status, 201);
  const j = await res.json();
  const [[s]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [j.session.id]);
  return { token: j.token, sessionId: s.id, participantPublicId: j.participant.id };
}
async function draft(guest) {
  const o = await (await g(guest.token, 'POST', '/api/session/orders', {})).json();
  const res = await g(guest.token, 'POST', `/api/session/orders/${o.id}/items`, { productCode: 'cafe', qty: 1 });
  assert.equal(res.status, 201);
  const [[it]] = await db.query('SELECT id FROM order_items WHERE order_id = ?', [o.id]);
  return { id: o.id, itemId: it.id };
}
async function confirmed(guest) {
  const o = await draft(guest);
  assert.equal((await g(guest.token, 'POST', `/api/session/orders/${o.id}/submit`)).status, 200);
  return o;
}
const session = async (id) => (await db.query('SELECT status, total_amount, paid_amount FROM table_sessions WHERE id = ?', [id]))[0][0];
const order = async (id) => (await db.query('SELECT status FROM orders WHERE id = ?', [id]))[0][0];
const tickets = async (id) => (await db.query('SELECT COUNT(*) n FROM kitchen_tickets WHERE order_id = ?', [id]))[0][0].n;
const countOrders = async (sid) => (await db.query('SELECT COUNT(*) n FROM orders WHERE session_id = ?', [sid]))[0][0].n;

async function assertSessionClosed(res) {
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'SESSION_CLOSED');
}
async function payAndClose(sessionId) {
  await paySvc.chargeSession(T, sessionId, { mode: 'GROUP', provider: 'CASH' }, { actorId: null });
  await tablesSvc.closeSession(T, sessionId, {});
}

// ------------------------------------------------------------ mesa cerrada
test('mesa cerrada: el token viejo no puede crear un pedido nuevo', async () => {
  const guest = await join(await newTable(), 'Ana');
  await confirmed(guest);
  await payAndClose(guest.sessionId);

  await assertSessionClosed(await g(guest.token, 'POST', '/api/session/orders', {}));
  assert.equal(await countOrders(guest.sessionId), 1);
  const s = await session(guest.sessionId);
  assert.equal(s.status, 'CLOSED');
  assert.equal(s.total_amount, s.paid_amount, 'la mesa cerrada no puede quedar con deuda');
});

test('mesa cerrada: un borrador que quedó abierto no llega a cocina ni se puede tocar', async () => {
  const guest = await join(await newTable(), 'Beto');
  const d = await draft(guest);
  await tablesSvc.closeSession(T, guest.sessionId, {}); // total 0 = 0: se puede cerrar con el borrador abierto

  await assertSessionClosed(await g(guest.token, 'POST', `/api/session/orders/${d.id}/submit`));
  await assertSessionClosed(await g(guest.token, 'POST', `/api/session/orders/${d.id}/items`, { productCode: 'cafe', qty: 1 }));
  await assertSessionClosed(await g(guest.token, 'PATCH', `/api/session/orders/${d.id}/items/${d.itemId}`, { qty: 3 }));
  await assertSessionClosed(await g(guest.token, 'DELETE', `/api/session/orders/${d.id}/items/${d.itemId}`));
  assert.equal((await order(d.id)).status, 'DRAFT');
  assert.equal(await tickets(d.id), 0);
});

test('mesa con cierre forzado: tampoco acepta pedidos', async () => {
  const guest = await join(await newTable(), 'Caro');
  await tablesSvc.forceCloseSession(T, guest.sessionId, 'prueba', {});
  await assertSessionClosed(await g(guest.token, 'POST', '/api/session/orders', {}));
});

test('mesa cerrada: el resto de las escrituras del comensal también se cortan', async () => {
  const guest = await join(await newTable(), 'Dani');
  const otro = await join(await newTable(), 'Eva');
  await tablesSvc.closeSession(T, guest.sessionId, {});

  await assertSessionClosed(await g(guest.token, 'POST', '/api/session/orders/close-all'));
  await assertSessionClosed(await g(guest.token, 'POST', '/api/session/participants', { displayName: 'Nuevo' }));
  await assertSessionClosed(await g(guest.token, 'DELETE', `/api/session/participants/${otro.participantPublicId}`));
  await assertSessionClosed(await g(guest.token, 'PUT', '/api/session/order-mode', { orderMode: 'GROUP' }));
  await assertSessionClosed(await g(guest.token, 'POST', '/api/session/payments', { mode: 'GROUP' }));
});

test('mesa cerrada: se conserva la lectura de lo consumido y el 409 de GET /api/session', async () => {
  const guest = await join(await newTable(), 'Flor');
  await confirmed(guest);
  await payAndClose(guest.sessionId);

  const orders = await g(guest.token, 'GET', '/api/session/orders');
  assert.equal(orders.status, 200);
  assert.equal((await orders.json()).mine.length, 1);
  assert.equal((await g(guest.token, 'GET', '/api/session/payments/balance')).status, 200);
  await assertSessionClosed(await g(guest.token, 'GET', '/api/session'));
});

test('escanear el QR después del cierre abre una mesa nueva y ahí sí se puede pedir', async () => {
  const qr = await newTable();
  const viejo = await join(qr, 'Gabi');
  await tablesSvc.closeSession(T, viejo.sessionId, {});

  const nuevo = await join(qr, 'Gabi');
  assert.notEqual(nuevo.sessionId, viejo.sessionId);
  const o = await confirmed(nuevo);
  assert.equal((await order(o.id)).status, 'QUEUED');
});

// ------------------------------------------------- pertenencia a la mesa
test('quitado de la mesa: su token deja de servir, para leer y para escribir', async () => {
  const qr = await newTable();
  const ana = await join(qr, 'Ana');
  const beto = await join(qr, 'Beto');
  const d = await draft(beto);
  const rm = await g(ana.token, 'DELETE', `/api/session/participants/${beto.participantPublicId}`);
  assert.equal(rm.status, 200);

  for (const [method, path, body] of [
    ['GET', '/api/session'],
    ['GET', '/api/session/orders'],
    ['GET', '/api/session/payments/balance'],
    ['GET', '/api/session/stream'],
    ['POST', '/api/session/orders', {}],
    ['POST', `/api/session/orders/${d.id}/submit`],
    ['POST', '/api/session/payments', { mode: 'GROUP' }],
  ]) {
    const res = await g(beto.token, method, path, body);
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  assert.equal((await order(d.id)).status, 'DRAFT');
  assert.equal(await tickets(d.id), 0);
});

test('quitar a alguien no afecta al resto ni a lo que esa persona ya había pedido', async () => {
  const qr = await newTable();
  const ana = await join(qr, 'Ana');
  const beto = await join(qr, 'Beto');
  const o = await confirmed(beto);
  await g(ana.token, 'DELETE', `/api/session/participants/${beto.participantPublicId}`);

  assert.equal((await order(o.id)).status, 'QUEUED');
  assert.equal((await session(ana.sessionId)).total_amount, '1000.00');
  const mine = await confirmed(ana);
  assert.equal((await order(mine.id)).status, 'QUEUED');
});

test('quitado de la mesa: escanear el QR lo vuelve a sumar con un participante nuevo', async () => {
  const qr = await newTable();
  const ana = await join(qr, 'Ana');
  const beto = await join(qr, 'Beto');
  await g(ana.token, 'DELETE', `/api/session/participants/${beto.participantPublicId}`);

  const devuelta = await join(qr, 'Beto');
  assert.notEqual(devuelta.participantPublicId, beto.participantPublicId);
  assert.equal((await g(devuelta.token, 'GET', '/api/session')).status, 200);
});

// ---------------------------------------------------------- staff (service)
test('staff: no puede crear un pedido sobre una mesa cerrada', async () => {
  const guest = await join(await newTable(), 'Hugo');
  await tablesSvc.closeSession(T, guest.sessionId, {});
  await assert.rejects(
    () => orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: guest.sessionId, channel: 'TABLE' }, staff),
    (err) => { assert.equal(err.status, 409); assert.equal(err.code, 'SESSION_CLOSED'); return true; }
  );
});

test('staff: no puede enviar a cocina ni editar pedidos de una mesa cerrada', async () => {
  const guest = await join(await newTable(), 'Ines');
  const d = await draft(guest);
  await tablesSvc.closeSession(T, guest.sessionId, {});
  const closed = (err) => { assert.equal(err.status, 409); assert.equal(err.code, 'SESSION_CLOSED'); return true; };

  await assert.rejects(() => orderSvc.submitOrder(T, d.id, staff), closed);
  await assert.rejects(() => orderSvc.addItem(T, d.id, { productCode: 'cafe', qty: 1 }, staff), closed);
  await assert.rejects(() => orderSvc.updateItem(T, d.id, d.itemId, { qty: 2 }, staff), closed);
  await assert.rejects(() => orderSvc.removeItem(T, d.id, d.itemId, staff), closed);
  const r = await orderSvc.submitAllDraftsInSession(T, guest.sessionId, staff);
  assert.deepEqual(r.submitted, []);
  assert.equal(r.skipped.length, 1);
  assert.equal(await tickets(d.id), 0);
});

test('staff: agregar a un pedido confirmado de una mesa cerrada no genera deuda ni ticket', async () => {
  const guest = await join(await newTable(), 'Juana');
  const o = await confirmed(guest);
  await payAndClose(guest.sessionId);
  const antes = await tickets(o.id);

  await assert.rejects(
    () => orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, staff),
    (err) => err.code === 'SESSION_CLOSED'
  );
  assert.equal(await tickets(o.id), antes);
  const s = await session(guest.sessionId);
  assert.equal(s.total_amount, s.paid_amount);
});

test('sin cambios: reenviar un pedido ya confirmado sigue siendo idempotente, y staff puede cancelarlo', async () => {
  const guest = await join(await newTable(), 'Kevin');
  const o = await confirmed(guest);
  await tablesSvc.forceCloseSession(T, guest.sessionId, 'prueba', {});

  assert.equal((await orderSvc.submitOrder(T, o.id, staff)).status, 'QUEUED');
  assert.equal((await orderSvc.cancelOrder(T, o.id, { reason: 'mesa cerrada' }, staff)).status, 'CANCELLED');
});

// ---------------------------------------------------------------- carrera
test('carrera cerrar vs. confirmar: nunca queda una mesa CLOSED con deuda', async () => {
  for (let i = 0; i < 25; i++) {
    const guest = await join(await newTable(), `Race${i}`);
    const d = await draft(guest);
    await Promise.allSettled([
      tablesSvc.closeSession(T, guest.sessionId, {}),
      g(guest.token, 'POST', `/api/session/orders/${d.id}/submit`),
    ]);
    const s = await session(guest.sessionId);
    if (s.status === 'CLOSED') {
      assert.equal(s.total_amount, s.paid_amount, `ronda ${i}: CLOSED con deuda`);
      assert.equal(await tickets(d.id), 0, `ronda ${i}: ticket de cocina con la mesa cerrada`);
    }
  }
});
