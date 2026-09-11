// Módulo payments (Fase 6 — Pagos).
//   staffRouter  -> /api/payments   (back-office / mostrador)
//   guestRouter  -> /api/session/payments  (comensal, gateado por JWT de mesa)
//   webhookRouter -> /webhooks/mercadopago (raw body, montado ANTES de express.json)
module.exports = {
  staffRouter: require('./payments.routes'),
  guestRouter: require('./payments.session.routes'),
  webhookRouter: require('./webhook.routes').buildWebhookRouter(),
};
