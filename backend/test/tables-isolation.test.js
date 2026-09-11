// Aislamiento entre empresas — mesas y sesiones. Dos empresas con mesa de
// IGUAL código; A nunca resuelve/lista nada de B. Nivel repositorio + servicio.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const repo = require('../src/modules/tables/tables.repository');
const svc = require('../src/modules/tables/tables.service');

const TA = 999995;
const TB = 999996;
const SAME_CODE = 'M1';
let a = {};
let b = {};

async function cleanup() {
  for (const t of [TA, TB]) {
    await db.query('DELETE FROM session_participants WHERE tenant_id = ?', [t]);
    await db.query('UPDATE tables SET current_session_id = NULL WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM table_sessions WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM qr_tokens WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM tables WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM domain_events WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM branches WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM tenants WHERE id = ?', [t]);
  }
}

async function seed(tid, label) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Mesa iso ${label}`, `mesa-iso-${label.toLowerCase()}`]);
  const [br] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', `Centro ${label}`]);
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code, name) VALUES (?, ?, ?, ?)', [tid, br.insertId, SAME_CODE, `Mesa ${label}`]);
  const token = await repo.createQrToken(tid, br.insertId, t.insertId);
  return { branchId: br.insertId, tableId: t.insertId, token };
}

before(async () => {
  await cleanup();
  a = await seed(TA, 'A');
  b = await seed(TB, 'B');
});

after(async () => {
  await cleanup();
  await db.end().catch(() => {});
});

test('findTable(A, <mesa de B>) -> null', async () => {
  assert.equal(await repo.findTable(TA, b.tableId), null);
  assert.ok(await repo.findTable(TB, b.tableId));
});

test('findTableByCode está scopeado por tenant y sucursal', async () => {
  const hitA = await repo.findTableByCode(TA, a.branchId, SAME_CODE);
  assert.equal(hitA.id, a.tableId);
  assert.equal(await repo.findTableByCode(TA, b.branchId, SAME_CODE), null);
});

test('listTables(A) sólo trae mesas de A', async () => {
  const list = await repo.listTables(TA, a.branchId);
  assert.ok(list.length >= 1 && list.every((t) => t.tenant_id === TA));
});

test('el QR resuelve SIEMPRE a su propio tenant (el token es la credencial)', async () => {
  const rowA = await repo.resolveActiveToken(a.token);
  assert.equal(rowA.tenant_id, TA);
  const rowB = await repo.resolveActiveToken(b.token);
  assert.equal(rowB.tenant_id, TB);
  // el token de A nunca resuelve a B
  assert.notEqual(rowA.tenant_id, rowB.tenant_id);
});

test('startSession con el token de A abre una sesión bajo TA, no TB', async () => {
  const r = await svc.startSession(a.token, { displayName: 'Test' }, {});
  const s = await repo.findSessionByPublicId(r.session.id);
  assert.equal(s.tenant_id, TA);
  assert.equal(s.table_id, a.tableId);
});

test('findActiveSessionByTable(B, <mesa de A>) -> null', async () => {
  assert.equal(await repo.findActiveSessionByTable(TB, a.tableId), null);
});
