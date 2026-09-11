// Levanta la app en un puerto efímero para los tests de integración y
// devuelve { baseUrl, close }. No arranca workers (outbox) ni valida la
// base al boot — los tests que necesitan base la usan directo por el pool.
const { createApp } = require('../../src/app');

async function startTestServer() {
  const app = createApp({
    // Mismo montaje que server.js: el webhook de MercadoPago necesita el
    // body crudo, ANTES de express.json(). Sin esto los tests de
    // /webhooks/mercadopago pegarían contra una ruta inexistente.
    mountWebhooksRaw: (a) => {
      a.use('/webhooks', require('../../src/modules/payments').webhookRouter);
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { startTestServer };
