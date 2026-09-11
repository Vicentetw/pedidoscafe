// Módulo tables (Fase 3 — Mesas / QR / sesiones).
//   staffRouter   -> /api/tables      (salón / back-office, con permisos)
//   publicRouter  -> /api/public      (comensal sin login: resolver QR + abrir sesión)
//   guestRouter   -> /api/session     (comensal en sesión, gateado por JWT de mesa)
module.exports = {
  staffRouter: require('./tables.routes'),
  publicRouter: require('./session.public.routes'),
  guestRouter: require('./session.routes'),
};
