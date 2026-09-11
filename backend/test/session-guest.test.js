// Endpoints del comensal gateados por el table_session_token (JWT), sin
// Firebase. Verifica lectura de la propia sesión, alta de participante,
// cambio de modo de pedido, y que un JWT sólo opera sobre SU sesión.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { startTestServer } = require('./helpers/server');
const repo = require('../src/modules/tables/tables.repository');
const { issueTableSessionToken } = require('../src/auth/sessionToken');

const T = 999991;
let srv;
let ctx = {};

async function cleanup() {
  await db.query('DELETE FROM session_participants WHERE tenant_id = ?', [T]);
  await db.query('UPDATE tables SET current_session_id = NULL WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM table_sessions WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM qr_tokens WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tables WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM domain_events WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM settings WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM branches WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tenants WHERE id = ?', [T]);
}

before(async () => {
  srv = await startTestServer();
  await cleanup();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Sesión guest', 'sesion-guest-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [t1] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, 'A1']);
  const [t2] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, 'A2']);

  const tok1 = await repo.createQrToken(T, ctx.branchId, t1.insertId);
  const tok2 = await repo.createQrToken(T, ctx.branchId, t2.insertId);
  const r1 = await fetch(`${srv.baseUrl}/api/public/table-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken: tok1, displayName: 'Juan' }),
  });
  ctx.tokenJuan = (await r1.json()).token;
  const r2 = await fetch(`${srv.baseUrl}/api/public/table-sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qrToken: tok2, displayName: 'Otro' }),
  });
  ctx.tokenOtraMesa = (await r2.json()).token;
});

after(async () => {
  await cleanup();
  await srv.close();
  await db.end().catch(() => {});
});

const auth = (tok) => ({ Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' });

test('sin token -> 401', async () => {
  const res = await fetch(`${srv.baseUrl}/api/session`);
  assert.equal(res.status, 401);
});

test('GET /api/session devuelve la propia sesión con "isYou" en el participante', async () => {
  const res = await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.session.status, 'OPEN');
  assert.equal(b.participants.length, 1);
  assert.equal(b.participants[0].name, 'Juan');
  assert.equal(b.participants[0].isYou, true);
});

test('POST /api/session/participants suma otra persona a la MISMA sesión', async () => {
  const res = await fetch(`${srv.baseUrl}/api/session/participants`, {
    method: 'POST', headers: auth(ctx.tokenJuan), body: JSON.stringify({ displayName: 'Pedro' }),
  });
  assert.equal(res.status, 201);
  const list = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.equal(list.participants.length, 2);
  assert.ok(list.participants.some((p) => p.name === 'Pedro' && !p.isYou));
});

test('DELETE /api/session/participants/:publicId saca a alguien de la lista (baja lógica)', async () => {
  const created = await (await fetch(`${srv.baseUrl}/api/session/participants`, {
    method: 'POST', headers: auth(ctx.tokenJuan), body: JSON.stringify({ displayName: 'Sobra' }),
  })).json();
  let list = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.ok(list.participants.some((p) => p.name === 'Sobra'));

  const del = await fetch(`${srv.baseUrl}/api/session/participants/${created.id}`, { method: 'DELETE', headers: auth(ctx.tokenJuan) });
  assert.equal(del.status, 200);
  assert.equal((await del.json()).removed, true);

  list = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.ok(!list.participants.some((p) => p.name === 'Sobra'), 'ya no debe listarse como presente');

  const [[row]] = await db.query('SELECT left_at FROM session_participants WHERE tenant_id = ? AND display_name = ?', [T, 'Sobra']);
  assert.ok(row.left_at, 'la fila sigue existiendo, sólo con left_at seteado (baja lógica, no borrado)');
});

test('sacar dos veces al mismo participante es idempotente (la segunda no "encuentra" a nadie para sacar)', async () => {
  const created = await (await fetch(`${srv.baseUrl}/api/session/participants`, {
    method: 'POST', headers: auth(ctx.tokenJuan), body: JSON.stringify({ displayName: 'Doble' }),
  })).json();
  const del1 = await fetch(`${srv.baseUrl}/api/session/participants/${created.id}`, { method: 'DELETE', headers: auth(ctx.tokenJuan) });
  assert.equal((await del1.json()).removed, true);
  const del2 = await fetch(`${srv.baseUrl}/api/session/participants/${created.id}`, { method: 'DELETE', headers: auth(ctx.tokenJuan) });
  assert.equal(del2.status, 200);
  assert.equal((await del2.json()).removed, false, 'ya se había ido; no es un error, pero tampoco vuelve a "sacarlo"');
});

test('un token de OTRA mesa no puede sacar a un participante de la mesa de Juan', async () => {
  const created = await (await fetch(`${srv.baseUrl}/api/session/participants`, {
    method: 'POST', headers: auth(ctx.tokenJuan), body: JSON.stringify({ displayName: 'ProtegidoDeOtraMesa' }),
  })).json();
  const del = await fetch(`${srv.baseUrl}/api/session/participants/${created.id}`, { method: 'DELETE', headers: auth(ctx.tokenOtraMesa) });
  assert.equal(del.status, 404);
  const list = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.ok(list.participants.some((p) => p.name === 'ProtegidoDeOtraMesa'), 'sigue en la mesa de Juan, intacto');
});

test('PUT /api/session/order-mode cambia a GROUP mientras la sesión está OPEN', async () => {
  const res = await fetch(`${srv.baseUrl}/api/session/order-mode`, {
    method: 'PUT', headers: auth(ctx.tokenJuan), body: JSON.stringify({ orderMode: 'GROUP' }),
  });
  assert.equal(res.status, 200);
  const b = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.equal(b.session.orderMode, 'GROUP');
});

// Pedido de la aceptación: "cada uno lo suyo" queda OCULTO hasta que el
// dueño lo habilite (por sucursal o para toda la empresa) — nunca
// alcanza con que el frontend esconda el botón, el backend lo rechaza igual.
test('sin el setting habilitado, GET /api/session dice allowIndividualPayment=false y PUT a INDIVIDUAL se rechaza', async () => {
  const b = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.equal(b.allowIndividualPayment, false);

  const res = await fetch(`${srv.baseUrl}/api/session/order-mode`, {
    method: 'PUT', headers: auth(ctx.tokenJuan), body: JSON.stringify({ orderMode: 'INDIVIDUAL' }),
  });
  assert.equal(res.status, 403);
});

test('con el setting habilitado por sucursal, sí se puede pasar a INDIVIDUAL', async () => {
  const settingsRepo = require('../src/modules/platform/settings.repository');
  await settingsRepo.set(T, 'orders.allow_individual_payment', true, { branchId: ctx.branchId });

  const b = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.equal(b.allowIndividualPayment, true);

  const res = await fetch(`${srv.baseUrl}/api/session/order-mode`, {
    method: 'PUT', headers: auth(ctx.tokenJuan), body: JSON.stringify({ orderMode: 'INDIVIDUAL' }),
  });
  assert.equal(res.status, 200);
  const after = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenJuan) })).json();
  assert.equal(after.session.orderMode, 'INDIVIDUAL');

  // vuelve a GROUP y borra el setting para no afectar el resto de los tests
  // (y para no dejar una fila en `settings` que rompa el cleanup: tiene FK
  // a `branches`, sin CASCADE).
  await fetch(`${srv.baseUrl}/api/session/order-mode`, { method: 'PUT', headers: auth(ctx.tokenJuan), body: JSON.stringify({ orderMode: 'GROUP' }) });
  await db.query('DELETE FROM settings WHERE tenant_id = ? AND `key` = ?', [T, 'orders.allow_individual_payment']);
});

test('un token firmado para OTRA sesión no ve la de Juan (cada token opera sobre la suya)', async () => {
  const b = await (await fetch(`${srv.baseUrl}/api/session`, { headers: auth(ctx.tokenOtraMesa) })).json();
  assert.ok(!b.participants.some((p) => p.name === 'Juan' || p.name === 'Pedro'));
});

test('un JWT con secreto inventado -> 401', async () => {
  const fake = require('jsonwebtoken').sign({ sid: 1, tid: T }, 'secreto-falso', { issuer: 'pedidoscofee', audience: 'table-session' });
  const res = await fetch(`${srv.baseUrl}/api/session`, { headers: auth(fake) });
  assert.equal(res.status, 401);
  // un token bien firmado pero para una sesión inexistente
  const orphan = issueTableSessionToken({ sessionId: 987654321, sessionPublicId: 'X'.repeat(26), tenantId: T, branchId: ctx.branchId, tableId: 1, participantId: 1 });
  const res2 = await fetch(`${srv.baseUrl}/api/session`, { headers: auth(orphan) });
  assert.equal(res2.status, 404);
});
