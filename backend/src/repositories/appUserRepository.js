const pool = require('../db');

// Portado de motor-laboral/repositories/appUserRepository.js del sistema de
// asistencia. Permisos efectivos = permisos de los roles asignados
// (user_roles → role_permissions) UNION overrides individuales
// (user_permissions con effect ALLOW) MENOS los DENY individuales.
// Un usuario sin roles y sin overrides no puede nada (salvo superadmin).

async function findByFirebaseUid(firebaseUid, conn = pool) {
  const [[user]] = await conn.query(
    `SELECT id, firebase_uid, email, display_name, tenant_id, default_branch_id,
            is_superadmin, status
       FROM app_users
      WHERE firebase_uid = :uid`,
    { uid: firebaseUid }
  );
  if (!user) return null;

  const [roleRows] = await conn.query(
    `SELECT rp.permission
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.app_user_id = :id`,
    { id: user.id }
  );
  const [overrideRows] = await conn.query(
    `SELECT permission, effect FROM user_permissions WHERE app_user_id = :id`,
    { id: user.id }
  );

  const permissions = new Set(roleRows.map((r) => r.permission));
  for (const o of overrideRows) {
    if (o.effect === 'ALLOW') permissions.add(o.permission);
    else if (o.effect === 'DENY') permissions.delete(o.permission);
  }

  return {
    id: user.id,
    firebaseUid: user.firebase_uid,
    email: user.email,
    displayName: user.display_name,
    tenantId: user.tenant_id,
    defaultBranchId: user.default_branch_id,
    isSuperadmin: Boolean(user.is_superadmin),
    isActive: user.status === 'active',
    status: user.status,
    permissions,
  };
}

module.exports = { findByFirebaseUid };
