// Módulo inventory (Fase 5 — Stock).
//   router        -> /api/inventory  (back-office: ingredientes, recetas, stock, compras)
//   stockService  -> reserva/liberación/consumo pesimista (lo usan orders y kitchen)
module.exports = {
  router: require('./inventory.routes'),
  stockService: require('./stock.service'),
};
