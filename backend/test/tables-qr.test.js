// Superficie del comensal sin login: resolver el QR + abrir/recuperar la
// sesión de mesa + emisión del table_session_token. No necesita Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const { config } = require('../src/config');
const { startTestServer } = require('./helpers/server');
const repo = require('../src/modules/tables/tables.repository');

const T = 999990;
let srv;
let ctx = {};

async function cleanup() {
  await db.query('DELETE FROM session_participants WHERE tenant_id = ?', [T]);
  await db.query('UPDATE tables SET current_session_id = NULL WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM table_sessions WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM qr_tokens WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tables WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM domain_events WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM branches WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tenants WHERE id = ?', [T]);
}

before(async () => {
  srv = await startTestServer();
  await cleanup();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Mesas QR', 'mesas-qr-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code, name, seats) VALUES (?, ?, ?, ?, ?)', [T, ctx.branchId, 'M8', 'Mesa 8', 4]);
  ctx.tableId = t.insertId;
  ctx.token = await repo.createQrToken(T, ctx.branchId, ctx.tableId);
  // un token rotado, para verificar que no resuelve
  ctx.oldToken = await repo.createQrToken(T, ctx.branchId, ctx.tableId);
  await db.query("UPDATE qr_tokens SET status = 'ROTATED' WHERE token = ?", [ctx.oldToken]);
});

after(async () => {
  await cleanup();
  await srv.close();
  await db.end().catch(() => {});
});

const get = (p) => fetch(`${srv.baseUrl}${p}`);
const post = (p, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /qr/:token/resolve devuelve la mesa (sin nada sensible)', async () => {
  const res = await get(`/api/public/qr/${ctx.token}/resolve`);
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.table.code, 'M8');
  assert.equal(b.branch.code, 'centro');
  assert.equal(b.tenant.slug, 'mesas-qr-test');
  assert.ok(!('price' in b) && !('tableId' in b) && !('tenantId' in b));
});

test('token inexistente o rotado -> 404 con el MISMO mensaje', async () => {
  const bad = await get('/api/public/qr/no-existe-1234567890/resolve');
  assert.equal(bad.status, 404);
  const rot = await get(`/api/public/qr/${ctx.oldToken}/resolve`);
  assert.equal(rot.status, 404);
  assert.equal((await bad.json()).error, (await rot.json()).error);
});

test('POST /table-sessions crea la sesión, suma participante y emite un JWT con el scope correcto', async () => {
  const res = await post('/api/public/table-sessions', { qrToken: ctx.token, displayName: 'Juan' });
  assert.equal(res.status, 201);
  const b = await res.json();
  assert.ok(b.token, 'debe venir el table_session_token');
  assert.equal(b.participant.displayName, 'Juan');
  assert.equal(b.session.status, 'OPEN');

  const claims = jwt.verify(b.token, config.sessionToken.secret, { issuer: 'pedidoscofee', audience: 'table-session' });
  assert.equal(claims.tid, T);
  assert.equal(claims.bid, ctx.branchId);
  assert.equal(claims.tbl, ctx.tableId);
  assert.ok(claims.sid && claims.pid);

  // la mesa quedó ocupada y apuntando a la sesión
  const [[tbl]] = await db.query('SELECT status, current_session_id FROM tables WHERE id = ?', [ctx.tableId]);
  assert.equal(tbl.status, 'OCCUPIED');
  assert.ok(tbl.current_session_id);
});

test('un 2º escaneo del MISMO QR recupera la sesión y suma otro participante (base del caso 6)', async () => {
  const r2 = await post('/api/public/table-sessions', { qrToken: ctx.token, displayName: 'María' });
  assert.equal(r2.status, 201);
  const b2 = await r2.json();
  assert.equal(b2.othersPresent, 1, 'María ve que ya hay 1 persona');

  const [[{ n: sessions }]] = await db.query("SELECT COUNT(*) n FROM table_sessions WHERE tenant_id = ? AND status NOT IN ('CLOSED','ABANDONED','FORCE_CLOSED')", [T]);
  assert.equal(sessions, 1, 'sigue habiendo UNA sola sesión activa');
  const [[{ n: parts }]] = await db.query('SELECT COUNT(*) n FROM session_participants WHERE tenant_id = ?', [T]);
  assert.equal(parts, 2);
});

test('un nombre repetido en la misma mesa se rechaza (NAME_TAKEN) salvo que confirme "soy yo" (claim)', async () => {
  const r1 = await post('/api/public/table-sessions', { qrToken: ctx.token, displayName: 'Vicente' });
  assert.equal(r1.status, 201);
  const b1 = await r1.json();

  const r2 = await post('/api/public/table-sessions', { qrToken: ctx.token, displayName: '  vicente  ' }); // espacios/mayúsculas no importan
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).code, 'NAME_TAKEN');

  const r3 = await post('/api/public/table-sessions', { qrToken: ctx.token, displayName: 'Vicente', claim: true });
  assert.equal(r3.status, 201);
  const b3 = await r3.json();
  assert.equal(b3.participant.id, b1.participant.id, 'reusa el MISMO participante, no crea uno nuevo');

  const [[{ n: parts }]] = await db.query(
    'SELECT COUNT(*) n FROM session_participants WHERE tenant_id = ? AND left_at IS NULL AND LOWER(display_name) = ?',
    [T, 'vicente']
  );
  assert.equal(parts, 1, 'sigue habiendo un solo "Vicente" activo, no dos');
});

test('dos escaneos SIMULTÁNEOS del mismo QR: 1 sesión, 2 participantes, 2 JWT', async () => {
  await db.query('DELETE FROM session_participants WHERE tenant_id = ?', [T]);
  await db.query('UPDATE tables SET current_session_id = NULL WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM table_sessions WHERE tenant_id = ?', [T]);

  const [a, c] = await Promise.all([
    post('/api/public/table-sessions', { qrToken: ctx.token, displayName: 'A' }),
    post('/api/public/table-sessions', { qrToken: ctx.token, displayName: 'C' }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(c.status, 201);
  const ba = await a.json();
  const bc = await c.json();
  const sidA = jwt.decode(ba.token).sid;
  const sidC = jwt.decode(bc.token).sid;
  assert.equal(sidA, sidC, 'ambos quedan en la MISMA sesión');
  assert.notEqual(jwt.decode(ba.token).pid, jwt.decode(bc.token).pid);

  const [[{ n }]] = await db.query("SELECT COUNT(*) n FROM table_sessions WHERE tenant_id = ? AND status = 'OPEN'", [T]);
  assert.equal(n, 1);
});

test('el body NO puede inyectar tenant/branch/table/price', async () => {
  await db.query('DELETE FROM session_participants WHERE tenant_id = ?', [T]);
  await db.query('UPDATE tables SET current_session_id = NULL WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM table_sessions WHERE tenant_id = ?', [T]);

  const res = await post('/api/public/table-sessions', {
    qrToken: ctx.token, displayName: 'X',
    tenantId: 1, branchId: 999, tableId: 999, tableCode: 'HACK', price: 0, total: 0,
  });
  assert.equal(res.status, 201);
  const claims = jwt.decode((await res.json()).token);
  assert.equal(claims.tid, T);         // el del QR, no el inyectado
  assert.equal(claims.tbl, ctx.tableId);
});
