const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { UnauthorizedError } = require('../errors');

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
function tableSessionMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token =
    (header.startsWith('Bearer ') ? header.slice(7).trim() : null) ||
    (typeof req.query.access_token === 'string' ? req.query.access_token : null);
  if (!token) return next(new UnauthorizedError('Escaneá el código de la mesa para empezar.'));
  try {
    req.tableSession = verifyTableSessionToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { issueTableSessionToken, verifyTableSessionToken, tableSessionMiddleware };
