const pool = require('../db');
const appUserRepository = require('../repositories/appUserRepository');

// Portado de appUserMiddleware.js del sistema de asistencia.
// Corre DESPUÉS de firebaseAuthMiddleware. Un login de Firebase válido NO
// alcanza: hace falta además una fila en app_users (la crea un admin o el
// superadmin), sino la cuenta está "logueada" pero no habilitada.

async function appUserMiddleware(req, res, next) {
  if (!req.user || !req.user.uid) {
    // Firebase Admin no configurado en local: se deja pasar sin identidad,
    // igual que firebaseAuthMiddleware. Las rutas que exigen permiso van a
    // cortar igual (requirePermission chequea req.appUser).
    return next();
  }
  try {
    const appUser = await appUserRepository.findByFirebaseUid(req.user.uid, pool);
    if (!appUser || !appUser.isActive) {
      return res.status(403).json({ error: 'Tu usuario no está habilitado en el sistema.', code: 'USER_NOT_ENABLED' });
    }
    req.appUser = appUser;
    return next();
  } catch (err) {
    req.log?.error('app_user_resolve_failed', { message: err.message });
    return res.status(500).json({ error: 'No se pudieron resolver tus permisos.', code: 'INTERNAL' });
  }
}

function requireSuperadmin(req, res, next) {
  if (!req.appUser) return res.status(401).json({ error: 'Necesitás iniciar sesión.', code: 'UNAUTHORIZED' });
  if (!req.appUser.isSuperadmin) {
    return res.status(403).json({ error: 'Esta acción es sólo para el operador de la plataforma.', code: 'FORBIDDEN' });
  }
  return next();
}

// requirePermission('orders:cancel')  ó  requirePermission('orders', 'cancel')
function requirePermission(a, b) {
  const permission = b === undefined ? a : `${a}:${b}`;
  return (req, res, next) => {
    if (!req.appUser) return res.status(401).json({ error: 'Necesitás iniciar sesión.', code: 'UNAUTHORIZED' });
    if (req.appUser.isSuperadmin || req.appUser.permissions.has(permission)) return next();
    return res.status(403).json({ error: `Te falta el permiso "${permission}".`, code: 'FORBIDDEN', details: { permission } });
  };
}

// Tenant efectivo del request. Un usuario normal SIEMPRE queda atado al
// suyo, mande lo que mande en la query. Sólo el superadmin puede pedir
// "ver como" una empresa vía ?tenantId=. Devuelve null si no hay
// req.appUser (dev sin Firebase) o si el superadmin no pidió una puntual.
function resolveTenantId(req) {
  if (!req.appUser) return null;
  if (req.appUser.isSuperadmin) {
    const q = req.query.tenantId;
    return q !== undefined && q !== '' ? Number(q) : null;
  }
  return req.appUser.tenantId;
}

// Igual que resolveTenantId pero corta con 400 si no se pudo determinar —
// para rutas de negocio que NO pueden operar sin tenant (todo salvo las de
// plataforma). El superadmin debe pasar ?tenantId= explícito.
function requireTenantId(req, res, next) {
  const tenantId = resolveTenantId(req);
  if (tenantId == null) {
    return res.status(400).json({
      error: req.appUser?.isSuperadmin
        ? 'Como superadmin, indicá la empresa con ?tenantId=.'
        : 'No se pudo determinar tu empresa.',
      code: 'TENANT_REQUIRED',
    });
  }
  req.tenantId = tenantId;
  return next();
}

// Fragmento WHERE para filtrar por tenant. El superadmin sin ?tenantId= no
// filtra (ve todo). Uso en un repo:
//   const f = tenantFilter(tenantId, 'o.tenant_id');
//   `... WHERE ${f.sql}`  con  f.params  al principio del array de binds.
function tenantFilter(tenantId, column = 'tenant_id') {
  if (tenantId == null) return { sql: '1=1', params: [] };
  return { sql: `${column} = ?`, params: [tenantId] };
}

module.exports = {
  appUserMiddleware,
  requireSuperadmin,
  requirePermission,
  resolveTenantId,
  requireTenantId,
  tenantFilter,
};
