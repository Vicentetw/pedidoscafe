const { config } = require('../config');
const { logger } = require('../logger');
const { ForbiddenError } = require('../errors');

// Cloudflare Turnstile — captcha para la superficie sin login (crear una
// sesión de mesa). Portado del turnstileService del sistema de asistencia,
// simplificado. Si no hay TURNSTILE_SECRET configurado, NO se exige (dev).

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstile(token, ip) {
  if (!config.publicSurface.turnstileSecret) return { success: true, skipped: true };
  if (!token) return { success: false, error: 'missing-token' };
  try {
    const body = new URLSearchParams({ secret: config.publicSurface.turnstileSecret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    const data = await res.json();
    return { success: !!data.success, codes: data['error-codes'] || [] };
  } catch (err) {
    logger.error('turnstile_verify_failed', { message: err.message });
    // Fail-open ante un error nuestro: mejor dejar pasar que trabar a un
    // comensal por una caída de red hacia Cloudflare.
    return { success: true, degraded: true };
  }
}

// Middleware: exige el token en el body (`turnstileToken`) sólo si hay secret.
async function requireTurnstile(req, res, next) {
  if (!config.publicSurface.turnstileSecret) return next();
  const result = await verifyTurnstile(req.body?.turnstileToken, req.ip);
  if (!result.success) {
    return next(new ForbiddenError('No pudimos verificar que no sos un bot. Recargá la página e intentá de nuevo.'));
  }
  return next();
}

module.exports = { verifyTurnstile, requireTurnstile };
