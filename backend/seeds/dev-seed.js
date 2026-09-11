#!/usr/bin/env node
// Seed de desarrollo. NO corre en producción. Crea datos mínimos para
// empezar a trabajar: una empresa, una sucursal, y (opcional) un usuario.
//
// Uso:
//   node seeds/dev-seed.js --tenant "Café Demo" --branch "Centro"
//   node seeds/dev-seed.js --superadmin-uid <firebase_uid> --superadmin-email admin@demo.test
//   node seeds/dev-seed.js --tenant "Café Demo" --owner-uid <uid> --owner-email dueno@demo.test
//
// El firebase_uid se saca de una cuenta ya creada en tu proyecto de
// Firebase (o de la consola). El seed NO crea usuarios en Firebase.

const { config, assertDbConfig } = require('../src/config');
assertDbConfig();
const db = require('../src/db');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function slugify(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function upsertTenant(name) {
  const slug = slugify(name);
  const [[existing]] = await db.query('SELECT id FROM tenants WHERE slug = :slug', { slug });
  if (existing) return existing.id;
  const [res] = await db.query('INSERT INTO tenants (name, slug) VALUES (:name, :slug)', { name, slug });
  return res.insertId;
}

async function upsertBranch(tenantId, name) {
  const code = slugify(name) || 'principal';
  const [[existing]] = await db.query(
    'SELECT id FROM branches WHERE tenant_id = :tenantId AND code = :code',
    { tenantId, code }
  );
  if (existing) return existing.id;
  const [res] = await db.query(
    'INSERT INTO branches (tenant_id, code, name) VALUES (:tenantId, :code, :name)',
    { tenantId, code, name }
  );
  return res.insertId;
}

async function upsertUser({ uid, email, tenantId, isSuperadmin, defaultBranchId }) {
  const [res] = await db.query(
    `INSERT INTO app_users (firebase_uid, email, tenant_id, default_branch_id, is_superadmin, status)
     VALUES (:uid, :email, :tenantId, :branchId, :su, 'active')
     ON DUPLICATE KEY UPDATE email = VALUES(email), tenant_id = VALUES(tenant_id),
       default_branch_id = VALUES(default_branch_id), is_superadmin = VALUES(is_superadmin), status = 'active'`,
    { uid, email, tenantId: isSuperadmin ? null : tenantId, branchId: defaultBranchId ?? null, su: isSuperadmin ? 1 : 0 }
  );
  const [[row]] = await db.query('SELECT id FROM app_users WHERE firebase_uid = :uid', { uid });
  void res;
  return row.id;

}

async function assignRole(appUserId, tenantId, roleCode) {
  const [[role]] = await db.query(
    'SELECT id FROM roles WHERE code = :code AND (tenant_id IS NULL OR tenant_id = :tenantId) ORDER BY tenant_id IS NULL LIMIT 1',
    { code: roleCode, tenantId }
  );
  if (!role) throw new Error(`No existe el rol "${roleCode}" (¿corriste las migraciones?)`);
  await db.query(
    `INSERT INTO user_roles (app_user_id, role_id, branch_id) VALUES (:u, :r, NULL)
     ON DUPLICATE KEY UPDATE role_id = role_id`,
    { u: appUserId, r: role.id }
  );
}

async function main() {
  if (config.env === 'production') {
    console.error('dev-seed.js no corre con NODE_ENV=production.');
    process.exit(1);
  }

  const tenantName = arg('tenant');
  const branchName = arg('branch', 'Principal');
  const superUid = arg('superadmin-uid');
  const superEmail = arg('superadmin-email');
  const ownerUid = arg('owner-uid');
  const ownerEmail = arg('owner-email');

  if (superUid && superEmail) {
    const id = await upsertUser({ uid: superUid, email: superEmail, isSuperadmin: true });
    console.log(`superadmin listo: app_users.id=${id} (${superEmail})`);
  }

  if (tenantName) {
    const tenantId = await upsertTenant(tenantName);
    const branchId = await upsertBranch(tenantId, branchName);
    console.log(`empresa "${tenantName}" id=${tenantId}, sucursal "${branchName}" id=${branchId}`);

    if (ownerUid && ownerEmail) {
      const uid = await upsertUser({ uid: ownerUid, email: ownerEmail, tenantId, isSuperadmin: false, defaultBranchId: branchId });
      await assignRole(uid, tenantId, 'owner');
      console.log(`dueño listo: app_users.id=${uid} (${ownerEmail}) con rol owner`);
    }
  }

  if (!tenantName && !superUid) {
    console.log('Nada que sembrar. Pasá --tenant y/o --superadmin-uid/--superadmin-email.');
  }
  await db.end();
}

main().catch(async (err) => {
  console.error(err.message);
  await db.end().catch(() => {});
  process.exit(1);
});
