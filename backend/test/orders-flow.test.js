// Circuito de pedidos del comensal, sin Firebase (superficie /api/session).
// Cubre: precio calculado por el backend (mandatory case #4), submit ->
// CONFIRMED/QUEUED + ticket de cocina, avance del ticket que arrastra al
// pedido, total de la mesa, y el caso obligatorio 6 (dos participantes,
// dos pedidos, una misma sesión).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { startTestServer } = require('./helpers/server');
const { resetTenant } = require('./helpers/db');
const tablesRepo = require('../src/modules/tables/tables.repository');

const T = 999810;
let srv;
let ctx = {};

before(async () => {
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Pedidos flow', 'pedidos-flow-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'ppal', 'Principal']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'cafe', 'Café']);
  const [p] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'latte', 'Latte', '4500.00']);
  await db.query('INSERT INTO product_variants (tenant_id, product_id, code, name, price_delta) VALUES (?, ?, ?, ?, ?)', [T, p.insertId, 'grande', 'Grande', '800.00']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'medialuna', 'Medialuna', '1200.00']);

  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, 'M1']);
  ctx.qr = await tablesRepo.createQrToken(T, ctx.branchId, tb.insertId);
});

after(async () => {
  await resetTenant(T).catch(() => {});
  if (srv) await srv.close();
  await db.end().catch(() => {});
});

async function scan(name) {
  const r = await fetch(`${srv.baseUrl}/api/public/table-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken: ctx.qr, displayName: name }),
  });
  return (await r.json()).token;
}
const g = (tok, m, p, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('el comensal arma un pedido; el precio lo pone el backend (ignora "unit_price" del body)', async () => {
  const tok = await scan('Juan');
  const order = await (await g(tok, 'POST', '/api/session/orders', {})).json();
  assert.equal(order.status, 'DRAFT');

  const withInjection = await g(tok, 'POST', `/api/session/orders/${order.id}/items`, {
    productCode: 'latte', variantCode: 'grande', qty: 2,
    unit_price: '1.00', price: 1, line_total: '1.00',   // ruido
  });
  assert.equal(withInjection.status, 201);
  const o1 = await withInjection.json();
  const item = o1.items[0];
  assert.equal(item.unit_price, '5300.00');     // 4500 + 800
  assert.equal(item.line_total, '10600.00');    // * 2
  assert.equal(o1.subtotal, '10600.00');
  assert.equal(o1.total, '10600.00');
  ctx.juanOrderId = order.id;
  ctx.juanTok = tok;
});

test('submit -> CONFIRMED/QUEUED, genera ticket de cocina y suma al total de la mesa', async () => {
  await g(ctx.juanTok, 'POST', `/api/session/orders/${ctx.juanOrderId}/items`, { productCode: 'medialuna', qty: 1 });
  const res = await g(ctx.juanTok, 'POST', `/api/session/orders/${ctx.juanOrderId}/submit`);
  assert.equal(res.status, 200);
  const o = await res.json();
  assert.equal(o.status, 'QUEUED');
  assert.equal(o.total, '11800.00');

  const [[{ n: tickets }]] = await db.query('SELECT COUNT(*) n FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, ctx.juanOrderId]);
  assert.equal(tickets, 1, 'sucursal sin estaciones -> un ticket general');
  const [[sess]] = await db.query('SELECT total_amount, status FROM table_sessions WHERE tenant_id = ?', [T]);
  assert.equal(sess.total_amount, '11800.00');
  assert.equal(sess.status, 'SERVING');
});

test('un pedido ya enviado no se puede editar', async () => {
  const res = await g(ctx.juanTok, 'POST', `/api/session/orders/${ctx.juanOrderId}/items`, { productCode: 'latte', qty: 1 });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'ORDER_NOT_EDITABLE');
});

test('avanzar el ticket arrastra el estado del pedido: PREPARING -> READY -> DELIVERED', async () => {
  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, ctx.juanOrderId]);
  const adv = () => fetch(`${srv.baseUrl}/api/kitchen/tickets/${tk.id}/advance`, { method: 'POST', headers: { 'x-internal': '1' } });
  // /api/kitchen exige Firebase; probamos el rollup vía el service directo
  const ksvc = require('../src/modules/orders/kitchen.service');
  let r = await ksvc.advanceTicket(T, tk.id, {}, null); // QUEUED -> PREPARING
  assert.equal(r.orderStatus, 'PREPARING');
  r = await ksvc.advanceTicket(T, tk.id, {}, null);     // PREPARING -> READY
  assert.equal(r.orderStatus, 'READY');
  r = await ksvc.advanceTicket(T, tk.id, {}, null);     // READY -> DELIVERED
  assert.equal(r.orderStatus, 'DELIVERED');
  void adv;
});

test('caso obligatorio 6: dos participantes, dos pedidos, una misma TableSession', async () => {
  const juan = ctx.juanTok;
  const maria = await scan('María');

  const oM = await (await g(maria, 'POST', '/api/session/orders', {})).json();
  await g(maria, 'POST', `/api/session/orders/${oM.id}/items`, { productCode: 'latte', qty: 1 });
  await g(maria, 'POST', `/api/session/orders/${oM.id}/submit`);

  const [rows] = await db.query(
    "SELECT session_id, participant_id, status FROM orders WHERE tenant_id = ? AND status NOT IN ('CANCELLED')", [T]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].session_id, rows[1].session_id, 'misma sesión');
  assert.notEqual(rows[0].participant_id, rows[1].participant_id, 'distinto participante');
  void juan;
});

test('privacidad: María ve su pedido completo y sólo un resumen del de Juan; "otra persona pidiendo"', async () => {
  const maria = await scan('María2');
  // Juan deja un borrador abierto
  const juan = ctx.juanTok;
  const draft = await (await g(juan, 'POST', '/api/session/orders', {})).json();
  await g(juan, 'POST', `/api/session/orders/${draft.id}/items`, { productCode: 'medialuna', qty: 1 });

  const view = await (await g(maria, 'GET', '/api/session/orders')).json();
  assert.ok(Array.isArray(view.mine));
  assert.ok(view.othersSummary.length >= 1, 've un resumen de los pedidos de otros');
  assert.ok(!JSON.stringify(view.othersSummary).includes('name_snapshot'), 'sin líneas de ítem de otros');
  assert.ok(view.someoneElseOrdering.length >= 1, 've que alguien más está pidiendo');
});

test('un comensal no puede editar el pedido de otro participante -> 403', async () => {
  const otro = await scan('Otro');
  const res = await g(otro, 'POST', `/api/session/orders/${ctx.juanOrderId}/items`, { productCode: 'latte', qty: 1 });
  assert.equal(res.status, 403);
});
