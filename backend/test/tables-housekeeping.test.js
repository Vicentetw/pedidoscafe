// Falla 8, parte 2A — mesas que quedaban abiertas para siempre.
//  - sin consumo e inactiva → se libera sola;
//  - saldada e inactiva → se cierra sola (nunca con cocina pendiente);
//  - con saldo → NUNCA se cierra sola: queda "colgada", se ve en
//    Conciliación y un QR nuevo no entra a la cuenta vieja (antes el
//    próximo cliente veía y podía pagar lo del grupo anterior);
//  - todo configurable por sucursal; hora de cierre del día.
require('../src/config');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');
const paySvc = require('../src/modules/payments/payments.service');
const settingsRepo = require('../src/modules/platform/settings.repository');
const hk = require('../src/modules/tables/tables.housekeeping');

const T = 998915;
const guest = { kind: 'guest', actorId: null };
const TZ = 'America/Argentina/Buenos_Aires';
let ctx = {};
let n = 0;

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Mesas solas', 'mesas-solas-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name, timezone) VALUES (?, ?, ?, ?)', [T, 'centro', 'Centro', TZ]);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'cafe', 'Café', '1000.00']);
});

beforeEach(async () => {
  // Sin cierre del día salvo en el test que lo prueba (si no, el test
  // dependería de la hora a la que se corre).
  await db.query('DELETE FROM settings WHERE tenant_id = ?', [T]);
  await settingsRepo.set(T, 'tables.day_close_hour', null);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

async function newSession() {
  n += 1;
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, `H${n}`]);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, t.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: `Cli${n}` }, {});
  const [[part]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  return { qr, sessionId: sess.id, participantId: part.id, tableId: t.insertId };
}
async function withConfirmedOrder(s) {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: s.sessionId, participantId: s.participantId, channel: 'TABLE' }, guest);
  await orderSvc.addItem(T, o.id, { productCode: 'cafe', qty: 1 }, guest);
  await orderSvc.submitOrder(T, o.id, guest);
  return o.id;
}
// Simula inactividad: la mesa y sus pedidos se movieron por última vez hace `min` minutos.
async function idle(sessionId, min) {
  await db.query('UPDATE orders SET updated_at = CURRENT_TIMESTAMP - INTERVAL ? MINUTE WHERE session_id = ?', [min, sessionId]);
  await db.query('UPDATE table_sessions SET last_activity_at = CURRENT_TIMESTAMP - INTERVAL ? MINUTE WHERE id = ?', [min, sessionId]);
}
const status = async (id) => (await db.query('SELECT status FROM table_sessions WHERE id = ?', [id]))[0][0].status;
const tableStatus = async (id) => (await db.query('SELECT status FROM tables WHERE id = ?', [id]))[0][0].status;

test('minutos desde el cierre del día', () => {
  const now = new Date('2026-11-10T08:30:00Z'); // 05:30 en Buenos Aires
  assert.equal(hk.minutesSinceDayClose(TZ, 4, now), 90);
  assert.equal(hk.minutesSinceDayClose(TZ, 6, now), 23 * 60 + 30);
  assert.equal(hk.minutesSinceDayClose(TZ, null, now), Infinity);
});

test('mesa sin consumo e inactiva 60 min se libera sola; con menos, no', async () => {
  const a = await newSession();
  const b = await newSession();
  await idle(a.sessionId, 61);
  await idle(b.sessionId, 10);
  await tablesSvc.runHousekeeping();
  assert.equal(await status(a.sessionId), 'ABANDONED');
  assert.equal(await tableStatus(a.tableId), 'FREE');
  assert.equal(await status(b.sessionId), 'OPEN');
  const [[audit]] = await db.query("SELECT action FROM audit_log WHERE tenant_id = ? AND entity_id = ? AND action = 'auto_release'", [T, String(a.sessionId)]);
  assert.ok(audit, 'queda auditado');
});

test('mesa saldada e inactiva 30 min se cierra sola; con cocina pendiente no', async () => {
  const done = await newSession();
  const oDone = await withConfirmedOrder(done);
  await db.query("UPDATE orders SET status = 'DELIVERED' WHERE id = ?", [oDone]);
  await paySvc.chargeSession(T, done.sessionId, { mode: 'GROUP', provider: 'CASH', cashSessionId: await cashId() }, { actorId: null, req: {} });

  const cooking = await newSession();
  await withConfirmedOrder(cooking); // queda en cocina (QUEUED)
  await paySvc.chargeSession(T, cooking.sessionId, { mode: 'GROUP', provider: 'CASH', cashSessionId: await cashId() }, { actorId: null, req: {} });

  await idle(done.sessionId, 31);
  await idle(cooking.sessionId, 31);
  await tablesSvc.runHousekeeping();
  assert.equal(await status(done.sessionId), 'CLOSED');
  assert.notEqual(await status(cooking.sessionId), 'CLOSED', 'la comida todavía no salió');
});

test('mesa con saldo nunca se cierra sola: queda colgada, aparece en Conciliación y un QR nuevo no entra', async () => {
  const s = await newSession();
  await withConfirmedOrder(s);
  await idle(s.sessionId, 5 * 60);
  await tablesSvc.runHousekeeping();
  assert.notEqual(await status(s.sessionId), 'CLOSED');

  const open = await tablesSvc.listOpenSessions(T, ctx.branchId);
  const row = open.find((x) => x.id === s.sessionId);
  assert.equal(row.stale, true);
  assert.ok(row.idleMinutes >= 299);

  const rec = await paySvc.getReconciliation(T, ctx.branchId);
  assert.ok(rec.staleSessions.some((x) => x.id === s.sessionId));

  await assert.rejects(() => tablesSvc.startSession(s.qr, { displayName: 'Otro' }, {}), (e) => { assert.equal(e.code, 'SESSION_STALE'); return true; });

  // El mozo confirma que sigue ocupada → deja de estar colgada y se puede entrar.
  await tablesSvc.reactivateSession(T, s.sessionId, {});
  const again = (await tablesSvc.listOpenSessions(T, ctx.branchId)).find((x) => x.id === s.sessionId);
  assert.equal(again.stale, false);
  const joined = await tablesSvc.startSession(s.qr, { displayName: 'Otro' }, {});
  assert.ok(joined.token);
});

test('configurable: apagado no cierra nada; los minutos se respetan por sucursal', async () => {
  const s = await newSession();
  await idle(s.sessionId, 120);
  await settingsRepo.set(T, 'tables.housekeeping_enabled', false);
  await tablesSvc.runHousekeeping();
  assert.equal(await status(s.sessionId), 'OPEN');

  await settingsRepo.set(T, 'tables.housekeeping_enabled', true);
  await settingsRepo.set(T, 'tables.auto_release_minutes', 180, { branchId: ctx.branchId });
  await tablesSvc.runHousekeeping();
  assert.equal(await status(s.sessionId), 'OPEN', '120 < 180 configurados para la sucursal');
});

test('hora de cierre del día: lo que no se movió desde esa hora se libera sin esperar los minutos', async () => {
  const s = await newSession();
  await settingsRepo.set(T, 'tables.auto_release_minutes', 600);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24;
  await settingsRepo.set(T, 'tables.day_close_hour', hour); // el cierre fue hace 0-59 min
  await idle(s.sessionId, 70); // última actividad antes del cierre
  await tablesSvc.runHousekeeping();
  assert.equal(await status(s.sessionId), 'ABANDONED');
});

let _cash = null;
async function cashId() {
  if (_cash) return _cash;
  const { openCash } = require('./helpers/cash');
  _cash = (await openCash(T, ctx.branchId)).id;
  return _cash;
}
