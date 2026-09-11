// Gating de permisos de caja por HTTP con ID token real de Firebase.
// mozo no tiene cash:*; cajero puede abrir/cerrar/mover pero NO crear
// cajas nuevas (cash:manage); encargado puede todo.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998970;
const UID_CAJA = 'test-cash-cajero';
const UID_ENC = 'test-cash-enc';
const UID_MOZO = 'test-cash-mozo';
let srv;
let cajaH;
let encH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Caja admin', 'caja-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  cajaH = await getTestAuthHeaders(UID_CAJA, { isSuperadmin: false, tenantId: T, roleCodes: ['cajero'] });
  encH = await getTestAuthHeaders(UID_ENC, { isSuperadmin: false, tenantId: T, roleCodes: ['encargado'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_CAJA).catch(() => {});
  await deleteTestUser(UID_ENC).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (m, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('un mozo no puede crear cajas ni ver el listado', { skip: SKIP }, async () => {
  assert.equal((await req('POST', `/api/cash/registers?branchId=${ctx.branchId}`, mozoH, { code: 'c1', name: 'Caja 1' })).status, 403);
  assert.equal((await req('GET', `/api/cash/registers?branchId=${ctx.branchId}`, mozoH)).status, 403);
});

test('un cajero NO puede crear una caja nueva (le falta cash:manage), pero el encargado sí', { skip: SKIP }, async () => {
  const byCaja = await req('POST', `/api/cash/registers?branchId=${ctx.branchId}`, cajaH, { code: 'c1', name: 'Caja 1' });
  assert.equal(byCaja.status, 403);
  const byEnc = await req('POST', `/api/cash/registers?branchId=${ctx.branchId}`, encH, { code: 'c1', name: 'Caja 1' });
  assert.equal(byEnc.status, 201);
  ctx.registerId = (await byEnc.json()).id;
});

test('el cajero SÍ puede abrir y cerrar esa caja', { skip: SKIP }, async () => {
  const open = await req('POST', `/api/cash/registers/${ctx.registerId}/open`, cajaH, { openingAmount: 1000 });
  assert.equal(open.status, 201);
  const sessionId = (await open.json()).id;
  const close = await req('POST', `/api/cash/sessions/${sessionId}/close`, cajaH, { closingAmount: 1000 });
  assert.equal(close.status, 200);
  assert.equal((await close.json()).status, 'CLOSED');
});
