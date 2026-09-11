// Gating de permisos de fidelización por HTTP con ID token real de Firebase.
// cajero tiene loyalty:view (consultar el saldo de un cliente) pero NO
// loyalty:adjust (ganar/canjear/ajustar a mano) ni settings:manage
// (niveles/regla) — igual que crm:manage, queda para dueño/admin/encargado.
// (mozo ni siquiera tiene loyalty:view — ver 0002_seed_system_roles.sql.)
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');
const crmSvc = require('../src/modules/crm/crm.service');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998710;
const UID_OWNER = 'test-loyalty-owner';
const UID_CAJA = 'test-loyalty-cajero';
let srv;
let ownerH;
let cajaH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Loyalty admin', 'loyalty-admin-test']);
  const cust = await crmSvc.createCustomer(T, { name: 'Cliente Test', phone: '1177770000' }, {});
  ctx.customerId = cust.id;
  ownerH = await getTestAuthHeaders(UID_OWNER, { isSuperadmin: false, tenantId: T, roleCodes: ['owner'] });
  cajaH = await getTestAuthHeaders(UID_CAJA, { isSuperadmin: false, tenantId: T, roleCodes: ['cajero'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_OWNER).catch(() => {});
  await deleteTestUser(UID_CAJA).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (m, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('el cajero puede consultar el saldo de un cliente pero no ajustarlo', { skip: SKIP }, async () => {
  const view = await req('GET', `/api/loyalty/accounts/${ctx.customerId}`, cajaH);
  assert.equal(view.status, 200);
  assert.equal((await view.json()).points_balance, 0);

  const blocked = await req('POST', `/api/loyalty/accounts/${ctx.customerId}/adjust`, cajaH, { points: 50, reason: 'intento sin permiso' });
  assert.equal(blocked.status, 403);
});

test('el dueño sí puede ajustar puntos a mano, y crear un nivel/regla', { skip: SKIP }, async () => {
  const adjusted = await req('POST', `/api/loyalty/accounts/${ctx.customerId}/adjust`, ownerH, { points: 50, reason: 'bienvenida' });
  assert.equal(adjusted.status, 200);
  assert.equal((await adjusted.json()).points_balance, 50);

  assert.equal((await req('POST', '/api/loyalty/tiers', cajaH, { code: 'x', name: 'X', minPoints: 0 })).status, 403);
  assert.equal((await req('POST', '/api/loyalty/tiers', ownerH, { code: 'bronce', name: 'Bronce', minPoints: 0 })).status, 201);
});
