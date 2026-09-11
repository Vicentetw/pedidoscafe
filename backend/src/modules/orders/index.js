// Módulo orders (Fase 4 — Pedidos y cocina; trackingRouter de la Fase 13).
//   staffRouter    -> /api/orders          (back-office / mostrador)
//   guestRouter    -> /api/session         (pedidos del comensal, gateado por JWT de mesa)
//   kitchenRouter  -> /api/kitchen         (KDS + setup de estaciones)
//   trackingRouter -> /api/public/orders   (seguimiento sin login, modo mostrador)
module.exports = {
  staffRouter: require('./orders.routes'),
  guestRouter: require('./orders.session.routes'),
  kitchenRouter: require('./kitchen.routes'),
  trackingRouter: require('./orderTracking.routes'),
};
