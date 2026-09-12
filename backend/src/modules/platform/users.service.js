const admin = require('firebase-admin');
const pool = require('../../db');
const repo = require('./users.repository');
const roleRepo = require('./roles.repository');
const branchRepo = require('./branches.repository');
const { withTransaction } = require('../../withTransaction');
const { NotFoundError, ConflictError, DomainError, ValidationError } = require('../../errors');
const { initFirebaseAdmin, isFirebaseReady } = require('../../auth/firebase');
const { writeAudit } = require('../../audit/audit');

// Perfil del usuario actual — lo consume el frontend (current-user.ts) para
// saber qué mostrar. Permisos ya resueltos (roles UNION overrides).
async function getMe(req) {
  if (!req.appUser) throw new NotFoundError('No hay un perfil asociado a tu sesión.');
  let tenantSlug = null;
  let tenantName = null;
  if (req.appUser.tenantId) {
    const [[t]] = await pool.query(`SELECT slug, name FROM tenants WHERE id = :id`, { id: req.appUser.tenantId });
    tenantSlug = t ? t.slug : null;
    tenantName = t ? t.name : null;
  }
  return {
    id: req.appUser.id,
    email: req.appUser.email,
    displayName: req.appUser.displayName,
    tenantId: req.appUser.tenantId,
    tenantSlug,
    tenantName,
    defaultBranchId: req.appUser.defaultBranchId,
    isSuperadmin: req.appUser.isSuperadmin,
    permissions: [...req.appUser.permissions].sort(),
  };
}

async function listUsers(tenantId) {
  return repo.listByTenant(tenantId);
}

async function ensureFirebase() {
  if (isFirebaseReady()) return;
  initFirebaseAdmin();
  if (!isFirebaseReady()) {
    throw new DomainError('Falta configurar Firebase Admin en el backend para gestionar usuarios.', {
      status: 503,
      code: 'FIREBASE_NOT_CONFIGURED',
    });
  }
}

async function validateRoles(tenantId, roles) {
  for (const r of roles) {
    const role = await roleRepo.findAssignable(tenantId, r.roleId);
    if (!role) throw new ValidationError(`El rol ${r.roleId} no existe o no se puede asignar en tu empresa.`);
    if (r.branchId != null && !(await branchRepo.findById(tenantId, r.branchId))) {
      throw new ValidationError(`La sucursal ${r.branchId} no existe en tu empresa.`);
    }
  }
}

async function firebaseUidOf(id) {
  const [[row]] = await pool.query(`SELECT firebase_uid FROM app_users WHERE id = :id`, { id });
  return row ? row.firebase_uid : null;
}

async function inviteUser(tenantId, input, req) {
  await ensureFirebase();
  if (await repo.findByEmailAnyTenant(input.email)) {
    throw new ConflictError('Ese email ya tiene una cuenta en el sistema.');
  }
  await validateRoles(tenantId, input.roles);

  let fbUser;
  try {
    fbUser = await admin.auth().getUserByEmail(input.email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    fbUser = await admin.auth().createUser({
      email: input.email,
      password: Math.random().toString(36).slice(-12) + 'A1!',
    });
  }

  const id = await withTransaction(async (conn) => {
    const newId = await repo.insert(
      {
        firebaseUid: fbUser.uid,
        email: input.email,
        displayName: input.displayName,
        tenantId,
        defaultBranchId: input.defaultBranchId,
      },
      conn
    );
    await repo.setRoles(newId, input.roles, conn);
    return newId;
  });

  // Sin infraestructura de mail propia: el link se le muestra a quien invita.
  let resetLink = null;
  try {
    resetLink = await admin.auth().generatePasswordResetLink(input.email);
  } catch {
    /* null no es fatal */
  }

  await writeAudit({
    req,
    tenantId,
    entityType: 'app_user',
    entityId: id,
    action: 'invite',
    after: { email: input.email, roles: input.roles },
  });
  const created = await repo.findInTenant(tenantId, id);
  return { ...created, resetLink };
}

async function updateUser(tenantId, id, patch, req) {
  const before = await repo.findInTenant(tenantId, id);
  if (!before) throw new NotFoundError('Ese usuario no existe en tu empresa.');
  if (before.is_superadmin) {
    throw new DomainError('No se puede editar al operador de la plataforma desde acá.', { status: 403, code: 'FORBIDDEN' });
  }
  if (patch.roles) await validateRoles(tenantId, patch.roles);
  if (patch.defaultBranchId != null && !(await branchRepo.findById(tenantId, patch.defaultBranchId))) {
    throw new ValidationError('Esa sucursal no existe en tu empresa.');
  }

  await withTransaction(async (conn) => {
    await repo.update(tenantId, id, patch, conn);
    if (patch.roles) await repo.setRoles(id, patch.roles, conn);
  });

  // Reflejar el alta/baja en Firebase (habilita/deshabilita el login).
  if (patch.status === 'disabled' || patch.status === 'active') {
    try {
      const uid = await firebaseUidOf(id);
      if (uid && isFirebaseReady()) {
        await admin.auth().updateUser(uid, { disabled: patch.status === 'disabled' });
      }
    } catch {
      /* Firebase puede no estar configurado en dev; el status local ya se guardó */
    }
  }

  await writeAudit({ req, tenantId, entityType: 'app_user', entityId: id, action: 'update', before, after: patch });
  return repo.findInTenant(tenantId, id);
}

module.exports = { getMe, listUsers, inviteUser, updateUser };
