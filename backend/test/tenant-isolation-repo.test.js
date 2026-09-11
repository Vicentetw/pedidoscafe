// Aislamiento entre empresas a nivel REPOSITORIO — no necesita Firebase ni
// HTTP, así que corre siempre que haya base migrada. Verifica la regla de
// oro del backend (ARQUITECTURA_V1 §13): todo repo recibe tenantId y NUNCA
// devuelve filas de otra empresa, aunque los datos sean idénticos.
//
// Complementa full-tenant-isolation.test.js (que prueba lo mismo por HTTP,
// con permisos reales) — este llega antes y no depende de credenciales.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const branchRepo = require('../src/modules/platform/branches.repository');
const roleRepo = require('../src/modules/platform/roles.repository');
const settingsRepo = require('../src/modules/platform/settings.repository');
const usersRepo = require('../src/modules/platform/users.repository');
const { integrationEnv } = require('./helpers/env');

// Sólo necesita DB (no Firebase). Si ni la base está, se salta.
const HAS_DB = !!(require('../src/config').config.db.database && require('../src/config').config.db.user);
const SKIP = HAS_DB ? false : 'sin base configurada (DB_*)';
void integrationEnv;

const TA = 999950;
const TB = 999951;
const SAME_CODE = 'centro';
const SAME_KEY = 'currency';
const SAME_ROLE = 'turno_x';

let branchA;
let branchB;

async function cleanup() {
  for (const t of [TA, TB]) {
    await db.query('DELETE FROM settings WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM user_roles WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [t]);
    await db.query('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = ?)', [t]);
    await db.query('DELETE FROM roles WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM app_users WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM branches WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM tenants WHERE id = ?', [t]);
  }
}

before(async () => {
  if (SKIP) return;
  await cleanup();
  for (const [id, label] of [[TA, 'A'], [TB, 'B']]) {
    await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [id, `Iso ${label}`, `iso-${label.toLowerCase()}-repo`]);
    const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [id, SAME_CODE, `Suc ${label}`]);
    if (label === 'A') branchA = b.insertId;
    else branchB = b.insertId;
    await settingsRepo.set(id, SAME_KEY, label === 'A' ? 'ARS' : 'USD');
    await db.query('INSERT INTO roles (tenant_id, code, name, is_system) VALUES (?, ?, ?, 0)', [id, SAME_ROLE, `Turno ${label}`]);
    await db.query(
      `INSERT INTO app_users (firebase_uid, email, tenant_id, is_superadmin, status)
       VALUES (?, ?, ?, 0, 'active')`,
      [`iso-repo-${label}`, `iso-${label}@repo.test`, id]
    );
  }
});

after(async () => {
  if (SKIP) return;
  await cleanup();
  await db.end();
});

test('branchRepo.list(A) no trae la sucursal de B (mismo code)', { skip: SKIP }, async () => {
  const listA = await branchRepo.list(TA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, branchA);
  assert.ok(!listA.some((b) => b.id === branchB));
});

test('branchRepo.findById(A, branchB) -> null', { skip: SKIP }, async () => {
  assert.equal(await branchRepo.findById(TA, branchB), null);
  assert.ok(await branchRepo.findById(TB, branchB));
});

test('branchRepo.findByCode(A, "centro") resuelve a la sucursal de A, no a la de B', { skip: SKIP }, async () => {
  const hit = await branchRepo.findByCode(TA, SAME_CODE);
  assert.equal(hit.id, branchA);
});

test('settingsRepo.getAll(A) devuelve el valor de A, nunca el de B', { skip: SKIP }, async () => {
  assert.equal((await settingsRepo.getAll(TA))[SAME_KEY], 'ARS');
  assert.equal((await settingsRepo.getAll(TB))[SAME_KEY], 'USD');
});

test('roleRepo.listForTenant(A) ve presets de sistema + su rol, no el rol de B', { skip: SKIP }, async () => {
  const roles = await roleRepo.listForTenant(TA);
  const mine = roles.filter((r) => r.scope === 'tenant');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, 'Turno A');
  assert.ok(roles.some((r) => r.code === 'owner' && r.scope === 'system'));
  assert.ok(!roles.some((r) => r.name === 'Turno B'));
});

test('roleRepo.findAssignable(A, <rol de B>) -> null', { skip: SKIP }, async () => {
  const [[roleB]] = await db.query('SELECT id FROM roles WHERE tenant_id = ? AND code = ?', [TB, SAME_ROLE]);
  assert.equal(await roleRepo.findAssignable(TA, roleB.id), null);
  assert.ok(await roleRepo.findAssignable(TB, roleB.id));
});

test('usersRepo.listByTenant(A) sólo trae usuarios de A', { skip: SKIP }, async () => {
  const users = await usersRepo.listByTenant(TA);
  assert.ok(users.length >= 1);
  assert.ok(users.every((u) => u.tenant_id === TA));
});

test('usersRepo.findInTenant(A, <user de B>) -> null', { skip: SKIP }, async () => {
  const [[ub]] = await db.query('SELECT id FROM app_users WHERE firebase_uid = ?', ['iso-repo-B']);
  assert.equal(await usersRepo.findInTenant(TA, ub.id), null);
});
