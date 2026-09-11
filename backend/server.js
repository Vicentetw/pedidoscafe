const { createApp } = require('./src/app');
const { config, assertDbConfig } = require('./src/config');
const { logger } = require('./src/logger');
const { initFirebaseAdmin } = require('./src/auth/firebase');
const { startOutboxWorker, stopOutboxWorker } = require('./src/events/outbox');
const releaseExpired = require('./src/jobs/releaseExpiredReservations');
const { closeAll: closeSse } = require('./src/http/sse');
const pool = require('./src/db');

async function main() {
  assertDbConfig();

  // Falla temprano si la base no responde.
  try {
    await pool.query('SELECT 1');
    logger.info('db_ok', { host: config.db.host, database: config.db.database });
  } catch (err) {
    logger.error('db_unreachable', { message: err.message });
    process.exit(1);
  }

  initFirebaseAdmin();

  const app = createApp({
    // /webhooks/mercadopago necesita el body CRUDO (para la firma) — se
    // monta ANTES de express.json(), ver src/app.js.
    mountWebhooksRaw: (app) => {
      app.use('/webhooks', require('./src/modules/payments').webhookRouter);
    },
  });

  const server = app.listen(config.port, () => {
    logger.info('http_listening', { port: config.port, env: config.env });
    if (!config.apiKey) logger.warn('api_key_not_set', { note: 'las rutas del staff no exigen x-api-key' });
  });

  startOutboxWorker({ intervalMs: 1000 });
  releaseExpired.start({ intervalMs: 60000 });

  const shutdown = (signal) => {
    logger.info('shutdown', { signal });
    stopOutboxWorker();
    releaseExpired.stop();
    closeSse();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('fatal_boot', { message: err.message, stack: err.stack });
  process.exit(1);
});
