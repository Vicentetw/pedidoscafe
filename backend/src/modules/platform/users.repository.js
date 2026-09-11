const pool = require('../../db');

// Repo de app_users + user_roles, scopeado a tenant. La resolución de
// permisos efectivos vive en repositories/appUserRepository.js (la usa el
// middleware de auth); acá es CRUD de administración.

async function listByTenant(tenantId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT u.id, u.email, u.display_name, u.tenant_id, u.default_branch_id, u.is_superadmin, u.status, u.created_at
       FROM app_users u
      WHERE u.tenant_id = :tenantId
      ORDER BY u.email`,
    { tenantId }
  );
  const [roleRows] = await conn.query(
    `SELECT ur.app_user_id, ur.role_id, ur.branch_id, r.code, r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN app_users u ON u.id = ur.app_user_id
      WHERE u.tenant_id = :tenantId`,
    { tenantId }
  );
  const rolesByUser = new Map();
  for (const rr of roleRows) {
    if (!rolesByUser.has(rr.app_user_id)) rolesByUser.set(rr.app_user_id, []);
    rolesByUser.get(rr.app_user_id).push({ roleId: rr.role_id, branchId: rr.branch_id, code: rr.code, name: rr.name });
  }
  return rows.map((u) => ({ ...u, roles: rolesByUser.get(u.id) || [] }));
}

async function findInTenant(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, email, display_name, tenant_id, default_branch_id, is_superadmin, status
       FROM app_users WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id }
  );
  return row || null;
}

async function findByEmailAnyTenant(email, conn = pool) {
  const [[row]] = await conn.query(`SELECT id, tenant_id FROM app_users WHERE email = :email`, { email });
  return row || null;
}

async function insert({ firebaseUid, email, displayName, tenantId, defaultBranchId }, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO app_users (firebase_uid, email, display_name, tenant_id, default_branch_id, is_superadmin, status)
     VALUES (:firebaseUid, :email, :displayName, :tenantId, :defaultBranchId, 0, 'active')`,
    { firebaseUid, email, displayName: displayName ?? null, tenantId, defaultBranchId: defaultBranchId ?? null }
  );
  return res.insertId;
}

async function update(tenantId, id, patch, conn = pool) {
  const fields = [];
  const params = { tenantId, id };
  if (patch.displayName !== undefined) { fields.push('display_name = :displayName'); params.displayName = patch.displayName; }
  if (patch.status !== undefined) { fields.push('status = :status'); params.status = patch.status; }
  if (patch.defaultBranchId !== undefined) { fields.push('default_branch_id = :dbid'); params.dbid = patch.defaultBranchId; }
  if (!fields.length) return;
  await conn.query(`UPDATE app_users SET ${fields.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, params);
}

async function setRoles(appUserId, roleAssignments, conn = pool) {
  await conn.query(`DELETE FROM user_roles WHERE app_user_id = :id`, { id: appUserId });
  if (!roleAssignments.length) return;
  const values = roleAssignments.map((r) => [appUserId, r.roleId, r.branchId ?? null]);
  await conn.query(`INSERT INTO user_roles (app_user_id, role_id, branch_id) VALUES ?`, [values]);
}

module.exports = { listByTenant, findInTenant, findByEmailAnyTenant, insert, update, setRoles };
