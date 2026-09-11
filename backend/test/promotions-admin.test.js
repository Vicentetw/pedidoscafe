// Gating de permisos de promociones por HTTP con ID token real de Firebase.
// mozo NO tiene promotions:view ni promotions:manage (0002_seed_system_roles.sql
// sólo se lo da a owner/admin*/stock/auditor — el resto del staff opera por
// código, sin navegar el catálogo de promos) — pero SÍ puede aplicar un
// código conocido a un pedido, porque eso es orders:amend, que mozo sí tiene.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998610;
const UID_OWNER = 'test-promo-owner';
const UID_MOZO = 'test-promo-mozo';
let srv;
let ownerH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Promo admin', 'promo-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1000.00']);
  ownerH = await getTestAuthHeaders(UID_OWNER, { isSuperadmin: false, tenantId: T, roleCodes: ['owner'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_OWNER).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (m, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('el mozo no puede crear ni listar promociones, pero sí aplicar un código conocido a un pedido', { skip: SKIP }, async () => {
  const blockedCreate = await req('POST', '/api/promotions', mozoH, { code: 'x', name: 'X', type: 'PERCENT', value: 10 });
  assert.equal(blockedCreate.status, 403);

  const created = await req('POST', '/api/promotions', ownerH, { code: 'diez', name: '10%', type: 'PERCENT', value: 10 });
  assert.equal(created.status, 201);

  const blockedList = await req('GET', '/api/promotions', mozoH);
  assert.equal(blockedList.status, 403);

  const orderRes = await req('POST', '/api/orders', mozoH, { branchId: ctx.branchId, channel: 'COUNTER' });
  const order = await orderRes.json();
  await req('POST', `/api/orders/${order.id}/items`, mozoH, { productCode: 'x', qty: 1 });

  const applied = await req('POST', `/api/orders/${order.id}/promotions/diez/apply`, mozoH);
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).discount_total, '100.00');
});
