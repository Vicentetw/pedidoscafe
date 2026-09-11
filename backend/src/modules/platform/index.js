const express = require('express');

// Módulo platform: empresas, sucursales, usuarios, roles y configuración.
// Se monta bajo /api/platform en routerRegistry.js.
const router = express.Router();

router.use('/tenants', require('./tenants.routes'));
router.use('/branches', require('./branches.routes'));
router.use('/users', require('./users.routes'));
router.use('/roles', require('./roles.routes'));
router.use('/settings', require('./settings.routes'));

module.exports = router;
