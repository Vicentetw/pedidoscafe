const pool = require('../../db');

// Roles visibles/asignables para una empresa = presets de sistema
// (tenant_id NULL) + roles propios de esa empresa (tenant_id = :tenantId).

async function listForTenant(tenantId, conn = pool) {
  const [roles] = await conn.query(
    `SELECT id, tenant_id, code, name, description, is_system
       FROM roles
      WHERE tenant_id IS NULL OR tenant_id = :tenantId
      ORDER BY is_system DESC, name`,
    { tenantId }
  );
  const ids = roles.map((r) => r.id);
  let permsByRole = new Map();
  if (ids.length) {
    const [perms] = await conn.query(
      `SELECT role_id, permission FROM role_permissions WHERE role_id IN (?)`,
      [ids]
    );
    for (const p of perms) {
      if (!permsByRole.has(p.role_id)) permsByRole.set(p.role_id, []);
      permsByRole.get(p.role_id).push(p.permission);
    }
  }
  return roles.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    isSystem: Boolean(r.is_system),
    scope: r.tenant_id == null ? 'system' : 'tenant',
    permissions: (permsByRole.get(r.id) || []).sort(),
  }));
}

async function findAssignable(tenantId, roleId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, code, is_system FROM roles
      WHERE id = :roleId AND (tenant_id IS NULL OR tenant_id = :tenantId)`,
    { roleId, tenantId }
  );
  return row || null;
}

async function findTenantRole(tenantId, roleId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, code, name, description FROM roles WHERE id = :roleId AND tenant_id = :tenantId`,
    { roleId, tenantId }
  );
  return row || null;
}

async function findTenantRoleByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM roles WHERE tenant_id = :tenantId AND code = :code`,
    { tenantId, code }
  );
  return row || null;
}

async function createTenantRole(tenantId, { code, name, description, permissions }, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO roles (tenant_id, code, name, description, is_system)
     VALUES (:tenantId, :code, :name, :description, 0)`,
    { tenantId, code, name, description: description ?? null }
  );
  if (permissions.length) {
    await conn.query(`INSERT INTO role_permissions (role_id, permission) VALUES ?`, [
      permissions.map((p) => [res.insertId, p]),
    ]);
  }
  return res.insertId;
}

async function replacePermissions(roleId, permissions, conn = pool) {
  await conn.query(`DELETE FROM role_permissions WHERE role_id = :roleId`, { roleId });
  if (permissions.length) {
    await conn.query(`INSERT INTO role_permissions (role_id, permission) VALUES ?`, [
      permissions.map((p) => [roleId, p]),
    ]);
  }
}

async function updateTenantRole(tenantId, roleId, patch, conn = pool) {
  const fields = [];
  const params = { tenantId, roleId };
  for (const k of ['name', 'description']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = :${k}`);
      params[k] = patch[k];
    }
  }
  if (fields.length) {
    await conn.query(`UPDATE roles SET ${fields.join(', ')} WHERE id = :roleId AND tenant_id = :tenantId`, params);
  }
}

async function deleteTenantRole(tenantId, roleId, conn = pool) {
  await conn.query(`DELETE FROM roles WHERE id = :roleId AND tenant_id = :tenantId`, { tenantId, roleId });
}

async function countUsersWithRole(roleId, conn = pool) {
  const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM user_roles WHERE role_id = :roleId`, { roleId });
  return n;
}

module.exports = {
  listForTenant,
  findAssignable,
  findTenantRole,
  findTenantRoleByCode,
  createTenantRole,
  replacePermissions,
  updateTenantRole,
  deleteTenantRole,
  countUsersWithRole,
};
