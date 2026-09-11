const geoip = require('geoip-lite');
const { config } = require('../config');
const { ForbiddenError } = require('../errors');

// Firewall por país para la superficie sin login (geoip-lite, base local).
// Portado del countryFirewallMiddleware del sistema de asistencia.
// Si COUNTRY_ALLOWLIST está vacío, no hace nada. Deja pasar siempre
// localhost / IPs privadas (dev y health checks internos).

function isPrivate(ip) {
  if (!ip) return true;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('::ffff:127.') ||
    ip.startsWith('::ffff:10.') ||
    ip.startsWith('::ffff:192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip.replace('::ffff:', ''))
  );
}

function countryFirewall(req, res, next) {
  const allow = config.publicSurface.countryAllowlist;
  if (!allow.length) return next();

  const ip = (req.ip || '').replace('::ffff:', '');
  if (isPrivate(ip)) return next();

  const geo = geoip.lookup(ip);
  const country = geo && geo.country;
  if (!country || allow.includes(country)) return next();

  req.log?.warn('country_firewall_block', { ip, country });
  return next(new ForbiddenError('Este servicio no está disponible en tu ubicación.'));
}

module.exports = { countryFirewall };
