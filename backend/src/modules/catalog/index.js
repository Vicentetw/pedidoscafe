// Módulo catalog (Fase 2 — Menú).
//   adminRouter  -> /api/catalog        (back-office, con permisos)
//   publicRouter -> /api/public/menu    (comensal, sin login)
module.exports = {
  adminRouter: require('./catalog.routes'),
  publicRouter: require('./menu.public.routes'),
};
