// Mesas / sesiones desde el salón — HTTP con ID token real de Firebase.
// Verifica alta de mesa (+ QR), rotación, apertura de sesión, cierre
// forzado auditado, y el gating de permisos (tables:manage / open_session /
// force_close).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 999992;
const UID_ENC = 'test-tables-encargado';
const UID_MOZO = 'test-tables-mozo';
let srv;
let encH;
let mozoH;
let branchId;

async function cleanup() {
  await db.query('DELETE FROM audit_log WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM session_participants WHERE tenant_id = ?', [T]);
  await db.query('UPDATE tables SET current_session_id = NULL WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM table_sessions WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM qr_tokens WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tables WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM user_roles WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [T]);
  await db.query('DELETE FROM app_users WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM domain_events WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM branches WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tenants WHERE id = ?', [T]);
}

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await cleanup();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Mesas admin', 'mesas-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  branchId = b.insertId;
  encH = await getTestAuthHeaders(UID_ENC, { isSuperadmin: false, tenantId: T, roleCodes: ['encargado'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_ENC).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await cleanup();
  await srv.close();
  await closeDb();
});

const req = (m, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('encargado crea una mesa y recibe un QR activo', { skip: SKIP }, async () => {
  const res = await req('POST', '/api/tables', encH, { branchId, code: 'M1', name: 'Mesa 1', seats: 4 });
  assert.equal(res.status, 201);
  const t = await res.json();
  assert.ok(t.qr_token && t.qr_token.length >= 40);
  // el QR resuelve por la superficie pública
  const r = await fetch(`${srv.baseUrl}/api/public/qr/${t.qr_token}/resolve`);
  assert.equal(r.status, 200);
});

test('un mozo NO puede crear mesas (le falta tables:manage) -> 403', { skip: SKIP }, async () => {
  const res = await req('POST', '/api/tables', mozoH, { branchId, code: 'M2' });
  assert.equal(res.status, 403);
});

test('rotar el QR: el token viejo deja de resolver, el nuevo sí', { skip: SKIP }, async () => {
  const [[t]] = await db.query('SELECT id FROM tables WHERE tenant_id = ? AND code = ?', [T, 'M1']);
  const [[old]] = await db.query("SELECT token FROM qr_tokens WHERE table_id = ? AND status = 'ACTIVE'", [t.id]);
  const res = await req('POST', `/api/tables/${t.id}/qr/rotate`, encH);
  assert.equal(res.status, 200);
  const nw = (await res.json()).qr_token;
  assert.notEqual(nw, old.token);
  assert.equal((await fetch(`${srv.baseUrl}/api/public/qr/${old.token}/resolve`)).status, 404);
  assert.equal((await fetch(`${srv.baseUrl}/api/public/qr/${nw}/resolve`)).status, 200);
});

test('abrir sesión desde el salón; un 2º intento sobre la misma mesa -> 409', { skip: SKIP }, async () => {
  const [[t]] = await db.query('SELECT id FROM tables WHERE tenant_id = ? AND code = ?', [T, 'M1']);
  const open = await req('POST', '/api/tables/sessions', encH, { tableId: t.id, assignSelfAsWaiter: true });
  assert.equal(open.status, 201);
  const again = await req('POST', '/api/tables/sessions', encH, { tableId: t.id });
  assert.equal(again.status, 409);
});

test('un mozo puede abrir sesión pero NO forzar el cierre', { skip: SKIP }, async () => {
  const [[t]] = await db.query('SELECT id FROM tables WHERE tenant_id = ? AND code = ?', [T, 'M1']);
  const [[s]] = await db.query("SELECT id FROM table_sessions WHERE table_id = ? AND status = 'OPEN'", [t.id]);
  const forced = await req('POST', `/api/tables/sessions/${s.id}/force-close`, mozoH, { reason: 'test' });
  assert.equal(forced.status, 403);
});

test('cierre forzado por el encargado: sesión FORCE_CLOSED, mesa libre, queda auditado', { skip: SKIP }, async () => {
  const [[t]] = await db.query('SELECT id FROM tables WHERE tenant_id = ? AND code = ?', [T, 'M1']);
  const [[s]] = await db.query("SELECT id FROM table_sessions WHERE table_id = ? AND status = 'OPEN'", [t.id]);
  const res = await req('POST', `/api/tables/sessions/${s.id}/force-close`, encH, { reason: 'cliente se fue sin pagar' });
  assert.equal(res.status, 200);
  const [[after]] = await db.query('SELECT status, close_reason FROM table_sessions WHERE id = ?', [s.id]);
  assert.equal(after.status, 'FORCE_CLOSED');
  assert.match(after.close_reason, /sin pagar/);
  const [[tbl]] = await db.query('SELECT status, current_session_id FROM tables WHERE id = ?', [t.id]);
  assert.equal(tbl.status, 'FREE');
  assert.equal(tbl.current_session_id, null);
  const [[a]] = await db.query("SELECT reason FROM audit_log WHERE tenant_id = ? AND action = 'force_close'", [T]);
  assert.match(a.reason, /sin pagar/);
});
