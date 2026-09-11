// Gating de permisos de analítica por HTTP con ID token real de Firebase.
// mozo NO tiene reports:view_sales (0002_seed_system_roles.sql no se lo da
// — a diferencia de crm:view/orders:amend, reportes de ventas quedan para
// roles con más responsabilidad); encargado sí.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998520;
const UID_ENC = 'test-analytics-enc';
const UID_MOZO = 'test-analytics-mozo';
let srv;
let encH;
let mozoH;
let ctx = {};
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Analytics admin', 'analytics-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  encH = await getTestAuthHeaders(UID_ENC, { isSuperadmin: false, tenantId: T, roleCodes: ['encargado'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_ENC).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (p, h) => fetch(`${srv.baseUrl}${p}`, { headers: h });

test('el mozo no puede ver el resumen de ventas; el encargado sí', { skip: SKIP }, async () => {
  const q = `?branchId=${ctx.branchId}&from=${today}&to=${today}`;
  const blocked = await req(`/api/analytics/sales-summary${q}`, mozoH);
  assert.equal(blocked.status, 403);

  const ok = await req(`/api/analytics/sales-summary${q}`, encH);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ordersCount, 0);
});
