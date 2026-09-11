const pool = require('../db');
const { logger } = require('../logger');

// Registro de auditoría (prompt.txt §46). Acciones sensibles: cambio de
// precio, anulación de venta, ajuste de stock, devolución, force-close de
// mesa, cambios de rol/permiso, acceso cruzado de un superadmin, etc.
// Guarda actor, entidad, acción, antes/después y motivo.
//
// Nunca hace fallar la operación que lo llamó: si el INSERT de auditoría
// falla, se loguea y se sigue. Acepta `conn` para escribir dentro de la
// transacción del service cuando corresponde.

/**
 * @param {object} entry
 * @param {import('express').Request} [entry.req]  para sacar actor + ip
 * @param {number} entry.tenantId
 * @param {number|null} [entry.branchId]
 * @param {string} entry.entityType   ej. 'product', 'order', 'role'
 * @param {string|number} entry.entityId
 * @param {string} entry.action        ej. 'update_price', 'cancel', 'force_close'
 * @param {object} [entry.before]
 * @param {object} [entry.after]
 * @param {string} [entry.reason]
 * @param {object} [conn]
 */
async function writeAudit(entry, conn = pool) {
  const { req } = entry;
  const actorUserId = req?.appUser?.id ?? null;
  const actorKind = req?.appUser ? (req.appUser.isSuperadmin ? 'system' : 'user') : req?.tableSession ? 'guest' : 'system';
  const ip = req?.ip ?? null;
  try {
    await conn.query(
      `INSERT INTO audit_log
         (tenant_id, branch_id, actor_user_id, actor_kind, ip, entity_type, entity_id, action, before_json, after_json, reason)
       VALUES
         (:tenantId, :branchId, :actorUserId, :actorKind, :ip, :entityType, :entityId, :action,
          CAST(:before AS JSON), CAST(:after AS JSON), :reason)`,
      {
        tenantId: entry.tenantId,
        branchId: entry.branchId ?? null,
        actorUserId,
        actorKind,
        ip,
        entityType: entry.entityType,
        entityId: String(entry.entityId),
        action: entry.action,
        before: JSON.stringify(entry.before ?? null),
        after: JSON.stringify(entry.after ?? null),
        reason: entry.reason ?? null,
      }
    );
  } catch (err) {
    logger.error('audit_write_failed', { message: err.message, entityType: entry.entityType, action: entry.action });
  }
}

module.exports = { writeAudit };
