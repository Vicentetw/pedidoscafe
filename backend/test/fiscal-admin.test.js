// Gating de permisos fiscales por HTTP con ID token real de Firebase.
// Configurar (settings:manage) y emitir (payments:charge) están fuera del
// alcance de un mozo.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998990;
const UID_OWNER = 'test-fiscal-owner';
const UID_MOZO = 'test-fiscal-mozo';
let srv;
let ownerH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Fiscal admin', 'fiscal-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
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

test('un mozo no puede ver ni configurar los datos fiscales', { skip: SKIP }, async () => {
  assert.equal((await req('GET', `/api/fiscal/config?branchId=${ctx.branchId}`, mozoH)).status, 403);
  assert.equal((await req('PUT', `/api/fiscal/config?branchId=${ctx.branchId}`, mozoH, { defaultDocType: 'TICKET' })).status, 403);
});

test('el dueño sí puede ver/configurar; por defecto ya emite ticket no fiscal (TICKET)', { skip: SKIP }, async () => {
  const res = await req('GET', `/api/fiscal/config?branchId=${ctx.branchId}`, ownerH);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).default_doc_type, 'TICKET');
});
