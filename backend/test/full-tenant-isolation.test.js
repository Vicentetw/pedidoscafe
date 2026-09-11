// Red de seguridad de aislamiento entre empresas (pedido explícito del
// usuario en INSTRUCCIONES.md §2: "me da miedo que se mezclen datos entre
// empresas"). Copia del enfoque de full-tenant-isolation.test.js del
// sistema de asistencia: DOS empresas con TODO igual a propósito (mismo
// código de sucursal, misma clave de config, mismo nombre de rol) y se
// verifica que un usuario de la empresa A, en CADA endpoint que lee datos,
// ve SOLO lo suyo y NUNCA nada de la B.
//
// A medida que avancen las fases (menú, mesas, pedidos, pagos) se agregan
// acá los endpoints nuevos con el mismo criterio.
//
// Empresas descartables 999931 / 999932. Borra todo al terminar.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const TA = 999931;
const TB = 999932;
const UID_A = 'test-tenant-iso-a';
const SHARED_BRANCH_CODE = 'centro';
const SHARED_SETTING_KEY = 'currency';
const SHARED_ROLE_CODE = 'turno_manana';

let srv;
let headersA;
let branchA;
let branchB;

async function cleanup() {
  for (const t of [TA, TB]) {
    await db.query('DELETE FROM audit_log WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM settings WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM user_roles WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [t]);
    await db.query('DELETE FROM user_permissions WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [t]);
    await db.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = ?)', [t]);
    await db.query('DELETE FROM roles WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM app_users WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM branches WHERE tenant_id = ?', [t]);
  }
  await db.query('DELETE FROM tenants WHERE id IN (?, ?)', [TA, TB]);
}

async function seedTenant(tid, label) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [
    tid,
    `Aislamiento ${label} (test)`,
    `aislamiento-${label.toLowerCase()}-test`,
  ]);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [
    tid,
    SHARED_BRANCH_CODE,
    `Sucursal ${label}`,
  ]);
  await db.query('INSERT INTO settings (tenant_id, branch_id, `key`, value) VALUES (?, NULL, ?, CAST(? AS JSON))', [
    tid,
    SHARED_SETTING_KEY,
    JSON.stringify(label === 'A' ? 'ARS' : 'USD'),
  ]);
  await db.query('INSERT INTO roles (tenant_id, code, name, is_system) VALUES (?, ?, ?, 0)', [
    tid,
    SHARED_ROLE_CODE,
    `Turno mañana ${label}`,
  ]);
  return b.insertId;
}

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await cleanup();
  branchA = await seedTenant(TA, 'A');
  branchB = await seedTenant(TB, 'B');
  headersA = await getTestAuthHeaders(UID_A, { isSuperadmin: false, tenantId: TA });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_A).catch(() => {});
  await cleanup();
  await srv.close();
  await closeDb();
});

function get(path) {
  return fetch(`${srv.baseUrl}${path}`, { headers: headersA });
}

test('Sucursales: la empresa A lista sólo su sucursal', { skip: SKIP }, async () => {
  const res = await get('/api/platform/branches');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.length, 1);
  assert.equal(data[0].id, branchA);
  assert.ok(!data.some((b) => b.id === branchB));
});

test('Sucursales: A no puede leer la sucursal de B por id -> 404', { skip: SKIP }, async () => {
  const res = await get(`/api/platform/branches/${branchB}`);
  assert.equal(res.status, 404);
});

test('Sucursales: A no puede editar la sucursal de B -> 404', { skip: SKIP }, async () => {
  const res = await fetch(`${srv.baseUrl}/api/platform/branches/${branchB}`, {
    method: 'PATCH',
    headers: { ...headersA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'HACKEADA' }),
  });
  assert.equal(res.status, 404);
  const [[row]] = await db.query('SELECT name FROM branches WHERE id = ?', [branchB]);
  assert.equal(row.name, 'Sucursal B');
});

test('Configuración: A ve su valor, nunca el de B', { skip: SKIP }, async () => {
  const res = await get('/api/platform/settings');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data[SHARED_SETTING_KEY], 'ARS');
});

test('Roles: A ve los presets de sistema y su rol propio, no el de B', { skip: SKIP }, async () => {
  const res = await get('/api/platform/roles');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  const mine = data.find((r) => r.code === SHARED_ROLE_CODE && r.scope === 'tenant');
  assert.ok(mine, 'debería ver su propio rol');
  assert.equal(mine.name, 'Turno mañana A');
  assert.ok(!data.some((r) => r.name === 'Turno mañana B'));
  assert.ok(data.some((r) => r.code === 'owner' && r.scope === 'system'));
});

test('Usuarios: A no ve usuarios de B', { skip: SKIP }, async () => {
  await getTestAuthHeaders('test-tenant-iso-b-user', { isSuperadmin: false, tenantId: TB });
  const res = await get('/api/platform/users');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.ok(data.every((u) => u.tenant_id === TA));
  await deleteTestUser('test-tenant-iso-b-user').catch(() => {});
});
