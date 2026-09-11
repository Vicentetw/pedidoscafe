const express = require('express');
const { handleStream } = require('./http/sse');

// Monta todos los routers de módulo bajo /api. A medida que avanzan las
// fases se agregan acá: catalog, inventory, tables, ordering, kitchen,
// payments, cash, crm, loyalty, promotions, etc.
function buildApiRouter() {
  const api = express.Router();

  // Tiempo real (SSE). El scope sale de req.appUser (staff). El stream del
  // comensal se agrega en la Fase 3 con su propio middleware de sesión.
  api.get('/stream', handleStream);

  api.use('/platform', require('./modules/platform'));

  const catalog = require('./modules/catalog');
  api.use('/catalog', catalog.adminRouter);
  api.use('/public/menu', catalog.publicRouter);

  const tables = require('./modules/tables');
  api.use('/tables', tables.staffRouter);
  api.use('/public', tables.publicRouter); // /api/public/qr/... y /api/public/table-sessions
  api.use('/session', tables.guestRouter); // gateado por table_session_token

  const orders = require('./modules/orders');
  api.use('/orders', orders.staffRouter);
  api.use('/session', orders.guestRouter); // /api/session/orders/...  (mismo gate JWT)
  api.use('/kitchen', orders.kitchenRouter);
  api.use('/public/orders', orders.trackingRouter); // seguimiento sin login (Fase 13)

  api.use('/inventory', require('./modules/inventory').router);

  const payments = require('./modules/payments');
  api.use('/payments', payments.staffRouter);
  api.use('/session/payments', payments.guestRouter);

  api.use('/cash', require('./modules/cash').router);
  api.use('/fiscal', require('./modules/fiscal').router);
  api.use('/crm', require('./modules/crm').router);
  api.use('/loyalty', require('./modules/loyalty').router);
  api.use('/promotions', require('./modules/promotions').router);
  api.use('/analytics', require('./modules/analytics').router);
  api.use('/devices', require('./modules/devices').router);

  return api;
}

module.exports = { buildApiRouter };
