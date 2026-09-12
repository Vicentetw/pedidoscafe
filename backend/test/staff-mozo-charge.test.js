// "Cada empresa configura si el mozo puede cobrar" (pedido en la
// aceptación) — setting staff.mozo_can_charge, leído en
// appUserRepository.findByFirebaseUid. Se prueba contra el repo
// directo (sin Firebase real: el mismo patrón que el resto de la suite
// cuando no hace falta pasar por el middleware de auth).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const appUserRepo = require('../src/repositories/appUserRepository');
const settingsRepo = require('../src/modules/platform/settings.repository');

const T = 999993;
let ctx = {};

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Mozo Cobra', 'mozo-cobra-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [[mozoRole]] = await db.query(`SELECT id FROM roles WHERE code = 'mozo' AND tenant_id IS NULL`);
  ctx.mozoRoleId = mozoRole.id;
  const [u] = await db.query(
    `INSERT INTO app_users (firebase_uid, email, tenant_id, default_branch_id, status) VALUES (?, ?, ?, ?, 'active')`,
    ['mozo-cobra-uid', 'mozo@cobra.test', T, ctx.branchId]
  );
  ctx.userId = u.insertId;
  await db.query(`INSERT INTO user_roles (app_user_id, role_id, branch_id) VALUES (?, ?, NULL)`, [ctx.userId, ctx.mozoRoleId]);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('por defecto (sin el setting), el mozo NO tiene payments:charge ni payments:view', async () => {
  const u = await appUserRepo.findByFirebaseUid('mozo-cobra-uid');
  assert.equal(u.permissions.has('payments:charge'), false);
  assert.equal(u.permissions.has('payments:view'), false);
});

test('con staff.mozo_can_charge=true en la empresa, el mozo suma payments:view y payments:charge', async () => {
  await settingsRepo.set(T, 'staff.mozo_can_charge', true);
  const u = await appUserRepo.findByFirebaseUid('mozo-cobra-uid');
  assert.equal(u.permissions.has('payments:charge'), true);
  assert.equal(u.permissions.has('payments:view'), true);
});

test('el setting no le da el permiso a un rol que no sea mozo (cocina, por ejemplo)', async () => {
  // El setting sigue en true desde el test anterior — esto confirma que el
  // efecto es puntual al rol "mozo", no un agujero general.
  const [[cocinaRole]] = await db.query(`SELECT id FROM roles WHERE code = 'cocina' AND tenant_id IS NULL`);
  const [u2] = await db.query(
    `INSERT INTO app_users (firebase_uid, email, tenant_id, default_branch_id, status) VALUES (?, ?, ?, ?, 'active')`,
    ['cocina-cobra-uid', 'cocina@cobra.test', T, ctx.branchId]
  );
  await db.query(`INSERT INTO user_roles (app_user_id, role_id, branch_id) VALUES (?, ?, NULL)`, [u2.insertId, cocinaRole.id]);
  const u = await appUserRepo.findByFirebaseUid('cocina-cobra-uid');
  assert.equal(u.permissions.has('payments:charge'), false);
  assert.equal(u.permissions.has('payments:view'), false);
});
