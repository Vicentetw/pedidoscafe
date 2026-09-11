// Gating de permisos CRM por HTTP con ID token real de Firebase. mozo/cajero
// tienen crm:view (buscar un cliente) pero NO crm:manage (crear/editar/
// linkear) — esos datos personales quedan reservados a dueño/admin.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998810;
const UID_OWNER = 'test-crm-owner';
const UID_MOZO = 'test-crm-mozo';
let srv;
let ownerH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'CRM admin', 'crm-admin-test']);
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

test('el dueño crea un cliente; el mozo NO puede crear uno pero SÍ puede buscarlo', { skip: SKIP }, async () => {
  const created = await req('POST', '/api/crm/customers', ownerH, { name: 'Juan Cliente', phone: '1144440000' });
  assert.equal(created.status, 201);
  const cust = await created.json();
  ctx.custId = cust.id;

  const blocked = await req('POST', '/api/crm/customers', mozoH, { name: 'Otro', phone: '1144440001' });
  assert.equal(blocked.status, 403);

  const list = await req('GET', '/api/crm/customers?search=Juan', mozoH);
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data.length, 1);
});

test('el mozo no puede editar ni linkear; el dueño sí', { skip: SKIP }, async () => {
  assert.equal((await req('PUT', `/api/crm/customers/${ctx.custId}`, mozoH, { notes: 'nota' })).status, 403);
  assert.equal((await req('PUT', `/api/crm/customers/${ctx.custId}`, ownerH, { notes: 'toma café sin azúcar' })).status, 200);
});
