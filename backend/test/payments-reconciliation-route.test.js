// Falla 7b — GET /api/payments/reconciliation quedaba tapada por
// GET /api/payments/:id (declarada antes): respondía 500 y la pantalla de
// Caja ocultaba la tarjeta de Conciliación sin avisar.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998967;
const UID = 'test-recon-route-enc';
let srv;
let h;
let branchId;

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Conciliación ruta', 'recon-route-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  branchId = b.insertId;
  h = await getTestAuthHeaders(UID, { isSuperadmin: false, tenantId: T, roleCodes: ['encargado'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

test('GET /api/payments/reconciliation responde 200 con las listas de conciliación', { skip: SKIP }, async () => {
  const res = await fetch(`${srv.baseUrl}/api/payments/reconciliation?branchId=${branchId}`, { headers: h });
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const k of ['stalePending', 'unpaidCounterOrders', 'forceClosedWithBalance', 'pendingRefunds', 'cancelledPaidOrders']) {
    assert.ok(Array.isArray(body[k]), `falta ${k}`);
  }
});

test('GET /api/payments/:id sigue funcionando (404 para un id que no existe)', { skip: SKIP }, async () => {
  const res = await fetch(`${srv.baseUrl}/api/payments/999999999`, { headers: h });
  assert.equal(res.status, 404);
});
