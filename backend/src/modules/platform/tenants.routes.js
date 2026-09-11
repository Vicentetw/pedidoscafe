const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireSuperadmin } = require('../../auth/appUserMiddleware');
const schema = require('./tenants.schema');
const service = require('./tenants.service');

// Empresas — sólo el operador de la plataforma (superadmin). Es una tabla
// de plataforma, no lleva scope de tenant.
const router = express.Router();

router.use(requireSuperadmin);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = schema.listQuery.parse(req.query);
    res.json({ data: await service.listTenants(query) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.getTenant(Number(req.params.id)));
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = schema.createTenant.parse(req.body);
    res.status(201).json(await service.createTenant(input, req));
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const patch = schema.updateTenant.parse(req.body);
    res.json(await service.updateTenant(Number(req.params.id), patch, req));
  })
);

module.exports = router;
