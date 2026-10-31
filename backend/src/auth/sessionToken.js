const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { UnauthorizedError, NotFoundError, ConflictError } = require('../errors');
const tablesRepo = require('../modules/tables/tables.repository');
const { TERMINAL } = require('../modules/tables/tableSession.stateMachine');

// table_session_token — el "pase" del comensal. Lo EMITE el backend tras
// validar el QR (Fase 3). El comensal no tiene app_user: su scope
// (tenant / branch / mesa / participante) sale de los claims firmados de
// ESTE token, nunca del body ni de la query (seguridad QR, ARQUITECTURA_V1 §15).
//
// Este módulo ya queda listo para la Fase 3; en la Fase 1 sólo se usa en
// tests unitarios de firmado/verificación.

const ISSUER = 'pedidoscofee';
const AUDIENCE = 'table-session';

/**
 * @param {{ sessionId:number, sessionPublicId:string, tenantId:number, branchId:number, tableId:number, participantId:number }} claims
 */
function issueTableSessionToken(claims) {
  return jwt.sign(
    {
      sid: claims.sessionId,
      spid: claims.sessionPublicId,
      tid: claims.tenantId,
      bid: claims.branchId,
      tbl: claims.tableId,
      pid: claims.participantId,
    },
    config.sessionToken.secret,
    {
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: `${config.sessionToken.ttlHours}h`,
    }
  );
}

/** Devuelve el scope o tira UnauthorizedError. */
function verifyTableSessionToken(token) {
  try {
    const p = jwt.verify(token, config.sessionToken.secret, { issuer: ISSUER, audience: AUDIENCE });
    return {
      sessionId: p.sid,
      sessionPublicId: p.spid,
      tenantId: p.tid,
      branchId: p.bid,
      tableId: p.tbl,
      participantId: p.pid,
    };
  } catch {
    throw new UnauthorizedError('Tu sesión de mesa venció o no es válida. Escaneá el código otra vez.');
  }
}

// Middleware para la superficie del comensal. El token viene por
// `Authorization: Bearer`; se acepta además `?access_token=` SÓLO porque
// EventSource (SSE) no permite mandar headers.
//
// Un JWT válido no alcanza: se revalida contra la base, porque el token no se
// revoca al cerrar la mesa ni al sacar a alguien. A quien ya no está en la mesa
// se le corta todo (401: el frontend limpia el token y vuelve a pedir el
// nombre). Con la mesa terminada se corta sólo lo que escribe: lo consumido se
// puede seguir consultando.
async function tableSessionMiddleware(req, res, next) {
  // /api/session/* pasa por varios routers gateados: se valida una sola vez.
  if (req.tableSession) return next();
  const header = req.headers.authorization || '';
  const token =
    (header.startsWith('Bearer ') ? header.slice(7).trim() : null) ||
    (typeof req.query.access_token === 'string' ? req.query.access_token : null);
  if (!token) return next(new UnauthorizedError('Escaneá el código de la mesa para empezar.'));
  try {
    const scope = verifyTableSessionToken(token);
    const access = await tablesRepo.findGuestAccess(scope.tenantId, scope.sessionId, scope.participantId);
    if (!access) throw new NotFoundError('Tu sesión de mesa ya no existe.');
    if (!access.participantActive) throw new UnauthorizedError('Ya no estás en esta mesa. Escaneá el código para volver a sumarte.');
    if (TERMINAL.has(access.status) && !['GET', 'HEAD'].includes(req.method)) {
      throw new ConflictError('Esta mesa ya se cerró. Si volviste a la mesa, escaneá el código de nuevo.', { code: 'SESSION_CLOSED' });
    }
    req.tableSession = scope;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { issueTableSessionToken, verifyTableSessionToken, tableSessionMiddleware };
