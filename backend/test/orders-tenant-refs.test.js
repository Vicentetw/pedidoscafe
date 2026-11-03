// Aislamiento entre empresas al CREAR un pedido (falla 2 de la auditoría del
// 2026-10-30): branchId / sessionId / customerId vienen del body del staff y
// tienen que ser de SU empresa. Además, el total de una mesa sólo suma
// pedidos de la empresa de esa mesa, aunque exista un pedido ajeno colgado
// de ella (datos creados antes de esta corrección).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');
const svc = require('../src/modules/orders/orders.service');
const repo = require('../src/modules/orders/orders.repository');
const tablesRepo = require('../src/modules/tables/tables.repository');

const { ok: RUN, skip: SKIP } = integrationEnv();
const TA = 998390;
const TB = 998391;
const UID_A = 'test-orders-tenant-refs-a';
const staff = { kind: 'staff', actorId: null };
let a = {};
let b = {};
let srv;
let headersA;

async function seed(tid, label) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Refs ${label}`, `refs-${label.toLowerCase()}`]);
  const [br] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', `Centro ${label}`]);
  const [br2] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'norte', `Norte ${label}`]);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [tid, c.insertId, 'cafe', 'Café', '2000.00']);
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [tid, br.insertId, 'M1']);
  const s = await tablesRepo.createSession(tid, { branchId: br.insertId, tableId: t.insertId, openedByKind: 'staff' });
  const [cu] = await db.query('INSERT INTO customers (tenant_id, name) VALUES (?, ?)', [tid, `Cliente ${label}`]);
  return { branchId: br.insertId, otherBranchId: br2.insertId, sessionId: s.id, customerId: cu.insertId };
}

async function cleanup() {
  // A primero: sus pedidos "colgados" de la mesa de B bloquean el borrado de B.
  await resetTenant(TA);
  await resetTenant(TB);
}

before(async () => {
  await cleanup();
  a = await seed(TA, 'A');
  b = await seed(TB, 'B');
  if (RUN) {
    srv = await startTestServer();
    headersA = await getTestAuthHeaders(UID_A, { isSuperadmin: false, tenantId: TA });
  }
});

after(async () => {
  if (RUN) {
    await deleteTestUser(UID_A).catch(() => {});
    if (srv) await srv.close();
  }
  await cleanup();
  await db.end().catch(() => {});
});

const rejects422 = (p) => assert.rejects(p, (e) => e.status === 422 && e.code === 'VALIDATION');
const countOrders = async (tid) => (await db.query('SELECT COUNT(*) n FROM orders WHERE tenant_id = ?', [tid]))[0][0].n;

test('createOrder con la sucursal de otra empresa -> 422 y no crea nada', async () => {
  const before = await countOrders(TA);
  await rejects422(svc.createOrder(TA, { branchId: b.branchId, channel: 'COUNTER' }, staff));
  assert.equal(await countOrders(TA), before);
});

test('createOrder con la mesa de otra empresa -> 422', async () => {
  await rejects422(svc.createOrder(TA, { branchId: a.branchId, sessionId: b.sessionId, channel: 'TABLE' }, staff));
});

test('createOrder con un cliente de otra empresa -> 422', async () => {
  await rejects422(svc.createOrder(TA, { branchId: a.branchId, customerId: b.customerId, channel: 'COUNTER' }, staff));
});

test('createOrder con una mesa de OTRA sucursal de la misma empresa -> 422', async () => {
  await rejects422(svc.createOrder(TA, { branchId: a.otherBranchId, sessionId: a.sessionId, channel: 'TABLE' }, staff));
});

test('referencias propias siguen funcionando (mesa + cliente, y mostrador sin mesa)', async () => {
  const o = await svc.createOrder(TA, { branchId: a.branchId, sessionId: a.sessionId, customerId: a.customerId, channel: 'TABLE' }, staff);
  assert.equal(o.session_id, a.sessionId);
  assert.equal(o.customer_id, a.customerId);
  const counter = await svc.createOrder(TA, { branchId: a.otherBranchId, channel: 'COUNTER' }, staff);
  assert.equal(counter.branch_id, a.otherBranchId);
});

test('el total de la mesa de B ignora un pedido de A colgado de ella (datos previos)', async () => {
  // Pedido legítimo de B: 2000.
  const ob = await svc.createOrder(TB, { branchId: b.branchId, sessionId: b.sessionId, channel: 'TABLE' }, staff);
  await svc.addItem(TB, ob.id, { productCode: 'cafe', qty: 1 }, staff);
  // Pedido de A apuntando a la mesa de B, como los que dejaba crear el bug.
  const rogue = await repo.createOrder(TA, { branchId: a.branchId, sessionId: b.sessionId, channel: 'TABLE', createdByKind: 'staff' });
  await db.query("UPDATE orders SET status = 'CONFIRMED', subtotal = 999, total = 999 WHERE id = ?", [rogue.id]);

  await svc.submitOrder(TB, ob.id, staff); // recalcula el total de la mesa de B
  const session = await tablesRepo.findSessionById(TB, b.sessionId);
  assert.equal(session.total_amount, '2000.00');
});

test('HTTP: staff de A no puede crear pedidos con sucursal, mesa o cliente de B', { skip: SKIP }, async () => {
  const post = (body) => fetch(`${srv.baseUrl}/api/orders`, {
    method: 'POST', headers: { ...headersA, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  for (const body of [
    { branchId: b.branchId },
    { branchId: a.branchId, sessionId: b.sessionId, channel: 'TABLE' },
    { branchId: a.branchId, customerId: b.customerId },
  ]) {
    const r = await post(body);
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.equal((await r.json()).code, 'VALIDATION');
  }
  const ok = await post({ branchId: a.branchId, sessionId: a.sessionId, channel: 'TABLE' });
  assert.equal(ok.status, 201);
});
