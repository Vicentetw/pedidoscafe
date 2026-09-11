// Aislamiento de PERMISOS (distinto del de tenant). Verifica que
// requirePermission corta según el rol, y que GET /users/me devuelve el
// set de permisos efectivos resuelto (roles UNION overrides).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 999940;
const UID_MOZO = 'test-rbac-mozo';
const UID_BRANCHVIEW = 'test-rbac-branchview';

let srv;

async function cleanup() {
  await db.query('DELETE FROM user_roles WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [T]);
  await db.query('DELETE FROM user_permissions WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [T]);
  await db.query('DELETE FROM audit_log WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM branches WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM app_users WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tenants WHERE id = ?', [T]);
}

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await cleanup();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'RBAC test', 'rbac-test']);
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_MOZO).catch(() => {});
  await deleteTestUser(UID_BRANCHVIEW).catch(() => {});
  await cleanup();
  await srv.close();
  await closeDb();
});

test('un mozo NO puede listar roles (le falta staff:view) -> 403', { skip: SKIP }, async () => {
  const headers = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
  const res = await fetch(`${srv.baseUrl}/api/platform/roles`, { headers });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'FORBIDDEN');
});

test('un mozo NO puede crear una sucursal (le falta branches:manage) -> 403', { skip: SKIP }, async () => {
  const headers = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
  const res = await fetch(`${srv.baseUrl}/api/platform/branches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'x', name: 'X' }),
  });
  assert.equal(res.status, 403);
});

test('GET /users/me devuelve el set de permisos del rol mozo', { skip: SKIP }, async () => {
  const headers = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
  const res = await fetch(`${srv.baseUrl}/api/platform/users/me`, { headers });
  assert.equal(res.status, 200);
  const me = await res.json();
  assert.ok(me.permissions.includes('orders:create'));
  assert.ok(me.permissions.includes('tables:open_session'));
  assert.ok(!me.permissions.includes('catalog:update_price'));
  assert.ok(!me.permissions.includes('payments:refund'));
  assert.equal(me.tenantId, T);
});

test('un usuario con branches:view puede listar pero no crear sucursales', { skip: SKIP }, async () => {
  const headers = await getTestAuthHeaders(UID_BRANCHVIEW, {
    isSuperadmin: false,
    tenantId: T,
    permissions: ['branches:view'],
  });
  const list = await fetch(`${srv.baseUrl}/api/platform/branches`, { headers });
  assert.equal(list.status, 200);
  const create = await fetch(`${srv.baseUrl}/api/platform/branches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'nueva', name: 'Nueva' }),
  });
  assert.equal(create.status, 403);
});

test('un DENY individual pisa el permiso que da el rol', { skip: SKIP }, async () => {
  const headers = await getTestAuthHeaders(UID_BRANCHVIEW, {
    isSuperadmin: false,
    tenantId: T,
    roleCodes: ['owner'],
  });
  // owner trae branches:manage; agregamos un override DENY
  const [[u]] = await db.query('SELECT id FROM app_users WHERE firebase_uid = ?', [UID_BRANCHVIEW]);
  await db.query(
    "INSERT INTO user_permissions (app_user_id, permission, effect) VALUES (?, 'branches:manage', 'DENY') " +
      'ON DUPLICATE KEY UPDATE effect = VALUES(effect)',
    [u.id]
  );
  const res = await fetch(`${srv.baseUrl}/api/platform/branches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'z', name: 'Z' }),
  });
  assert.equal(res.status, 403);
});
