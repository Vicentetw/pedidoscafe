const express = require('express');
const { applySecurity } = require('./http/security');
const { httpLogger } = require('./logger');
const { errorHandler, notFound } = require('./http/errorHandler');
const { buildApiRouter } = require('./routerRegistry');

// Construye la app Express. Separado de server.js para que los tests la
// levanten sin abrir el puerto ni arrancar workers.
//
// Orden de montaje (ARQUITECTURA_V1 §17), crítico para MercadoPago:
//   1. webhook MP con body CRUDO, ANTES de express.json y de security
//      (lo agrega server.js en la Fase 6 — acá queda el hook)
//   2. express.json
//   3. security (helmet, cors, rate-limit, api-key, firebase, app_users)
//   4. routers de /api
//   5. errorHandler
function createApp({ mountWebhooksRaw } = {}) {
  const app = express();

  // (1) Punto de extensión para webhooks que necesitan raw body.
  if (typeof mountWebhooksRaw === 'function') mountWebhooksRaw(app);

  // (2)
  app.use(express.json({ limit: '1mb' }));

  // Log estructurado con request_id. Antes de security para capturar
  // también los 401/403.
  app.use(httpLogger);

  // /health es público (sin las 3 capas de identidad).
  app.use('/health', require('./modules/health/health.routes'));

  // (3)
  // /api/session no lleva Firebase: se gatea con el table_session_token (JWT)
  // dentro de su propio router.
  applySecurity(app, { publicPaths: ['/health', '/webhooks', '/api/public', '/api/session'] });

  // (4)
  app.use('/api', buildApiRouter());

  // (5)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
