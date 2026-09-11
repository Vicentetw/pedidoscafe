const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { config } = require('../config');
const { firebaseAuthMiddleware } = require('../auth/firebase');
const { appUserMiddleware } = require('../auth/appUserMiddleware');

// Portado del sistema de asistencia (security.js), generalizado a este
// proyecto. Tres capas para las rutas del back-office / staff:
//   1. API_KEY (x-api-key)  — filtro anti-bots, NO identifica usuarios.
//   2. Firebase ID token    — identifica a la persona.
//   3. app_users            — a qué empresa pertenece y qué puede hacer.
// Las rutas bajo `publicPaths` (superficie del comensal, webhooks, health)
// pasan helmet + rate-limit + CORS pero SALTAN las 3 capas de identidad:
// por definición las llama alguien que todavía no tiene cuenta.

const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, probá de nuevo en un momento.', code: 'RATE_LIMITED' },
});

function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

// Firma `(origin, callback)` del paquete `cors` cuando se pasa como
// opción `origin`. `origin` es el string del header Origin (o undefined
// para curl / server-to-server, que se dejan pasar). OJO: el sistema de
// asistencia pasaba acá una función `(req, callback)`, que `cors` invoca
// con el string de origen — `req.headers` daba undefined y terminaba
// permitiendo TODO. Acá se corrige.
function corsOriginCheck(origin, callback) {
  if (!origin) return callback(null, true);
  const allowLocal =
    isLocalhostOrigin(origin) && config.corsOrigins.some((o) => /localhost|127\.0\.0\.1/.test(o));
  if (config.corsOrigins.includes(origin) || allowLocal) return callback(null, true);
  return callback(new Error(`CORS: origen no permitido (${origin})`));
}

function apiKeyMiddleware(req, res, next) {
  if (!config.apiKey) return next(); // sin API_KEY configurada, no se exige (dev)
  const headerKey = req.headers['x-api-key'];
  const bearer = req.headers['authorization'];
  if (headerKey === config.apiKey || bearer === `Bearer ${config.apiKey}`) return next();
  return res.status(401).json({ error: 'No autorizado.', code: 'UNAUTHORIZED' });
}

// Bug real del sistema de asistencia: un startsWith ingenuo hacía que
// '/api/publicidad' matcheara el prefijo público '/api/public'. Se exige
// que después del prefijo venga '/' o termine ahí.
function isPublicPath(req, publicPaths) {
  return publicPaths.some((p) => req.path === p || req.path.startsWith(p + '/'));
}

function applySecurity(app, { publicPaths = [] } = {}) {
  app.disable('x-powered-by');
  // Detrás de UN proxy (Render/Railway/Fly ponen exactamente uno). No usar
  // 'true': permitiría falsificar X-Forwarded-For y saltear el rate-limit.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(apiRateLimiter);
  app.use(cors({ origin: corsOriginCheck, optionsSuccessStatus: 200 }));

  const gate = (mw) => (req, res, next) => (isPublicPath(req, publicPaths) ? next() : mw(req, res, next));
  app.use(gate(apiKeyMiddleware));
  app.use(gate(firebaseAuthMiddleware));
  app.use(gate(appUserMiddleware));
}

module.exports = { applySecurity, corsOriginCheck, isPublicPath, apiKeyMiddleware };
