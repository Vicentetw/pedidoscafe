// Clientes — alta con duplicados por teléfono/email, preferencias, vínculo
// con el participante de una mesa y con un pedido de mostrador, historial
// combinado. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const crmSvc = require('../src/modules/crm/crm.service');
const orderSvc = require('../src/modules/orders/orders.service');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');

const T = 998800;
let ctx = {};
const staff = {};

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'CRM', 'crm-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1000.00']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('crear un cliente y buscarlo por nombre/teléfono', async () => {
  const cust = await crmSvc.createCustomer(T, { name: 'Ana Pérez', phone: '1155550000', email: 'ana@example.com' }, {});
  assert.ok(cust.id);
  assert.equal(cust.name, 'Ana Pérez');
  ctx.anaId = cust.id;

  const bySearch = await crmSvc.listCustomers(T, { search: '1155550000' });
  assert.equal(bySearch.length, 1);
  assert.equal(bySearch[0].id, cust.id);
});

test('no se puede crear dos clientes con el mismo teléfono (ni el mismo email)', async () => {
  await assert.rejects(() => crmSvc.createCustomer(T, { name: 'Otra Ana', phone: '1155550000' }, {}));
  await assert.rejects(() => crmSvc.createCustomer(T, { name: 'Otra Ana', email: 'ana@example.com' }, {}));
});

test('dos clientes SIN teléfono ni email conviven bien (NULL no es duplicado)', async () => {
  const c1 = await crmSvc.createCustomer(T, { name: 'Cliente anónimo 1' }, {});
  const c2 = await crmSvc.createCustomer(T, { name: 'Cliente anónimo 2' }, {});
  assert.notEqual(c1.id, c2.id);
});

test('preferencias: set/list, y pisar el mismo key actualiza en vez de duplicar', async () => {
  await crmSvc.setPreference(T, ctx.anaId, 'bebida', 'café con leche', {});
  await crmSvc.setPreference(T, ctx.anaId, 'alergia', 'maní', {});
  await crmSvc.setPreference(T, ctx.anaId, 'bebida', 'té verde', {});
  const prefs = await crmSvc.listPreferences(T, ctx.anaId);
  assert.equal(prefs.length, 2);
  assert.equal(prefs.find((p) => p.key === 'bebida').value, 'té verde');
});

test('un pedido de mostrador con customerId queda en el historial del cliente y actualiza last_order_at', async () => {
  const before = await crmSvc.getCustomer(T, ctx.anaId);
  assert.equal(before.last_order_at, null);

  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER', customerId: ctx.anaId }, { kind: 'staff', actorId: null });
  const history = await crmSvc.listOrders(T, ctx.anaId);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, o.id);

  const after = await crmSvc.getCustomer(T, ctx.anaId);
  assert.ok(after.last_order_at, 'last_order_at debe quedar seteado');
});

test('linkear un participante de mesa a un cliente lo suma a su historial, aunque el pedido no tenga customerId propio', async () => {
  const [tb] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, 'M1']);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, tb.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: 'Ana' }, {});
  const [[pRow]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);

  await crmSvc.linkParticipant(T, ctx.anaId, pRow.id, {});

  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sess.id, participantId: pRow.id, channel: 'TABLE' }, { kind: 'guest' });
  const history = await crmSvc.listOrders(T, ctx.anaId);
  assert.ok(history.some((h) => h.id === o.id));
});

test('linkear un participante inexistente -> 404 (NotFoundError)', async () => {
  await assert.rejects(() => crmSvc.linkParticipant(T, ctx.anaId, 999999, {}), /no existe/);
});

test('getCustomer/listOrders de un cliente inexistente -> NotFoundError', async () => {
  await assert.rejects(() => crmSvc.getCustomer(T, 999999));
  await assert.rejects(() => crmSvc.listOrders(T, 999999));
});
