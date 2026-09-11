const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const schema = require('./branches.schema');
const service = require('./branches.service');

// Sucursales. Scope de tenant obligatorio (requireTenantId cuelga req.tenantId).
const router = express.Router();
router.use(requireTenantId);

router.get(
  '/',
  requirePermission('branches:view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.listBranches(req.tenantId) });
  })
);

router.get(
  '/:id',
  requirePermission('branches:view'),
  asyncHandler(async (req, res) => {
    res.json(await service.getBranch(req.tenantId, Number(req.params.id)));
  })
);

router.post(
  '/',
  requirePermission('branches:manage'),
  asyncHandler(async (req, res) => {
    const input = schema.createBranch.parse(req.body);
    res.status(201).json(await service.createBranch(req.tenantId, input, req));
  })
);

router.patch(
  '/:id',
  requirePermission('branches:manage'),
  asyncHandler(async (req, res) => {
    const patch = schema.updateBranch.parse(req.body);
    res.json(await service.updateBranch(req.tenantId, Number(req.params.id), patch, req));
  })
);

router.delete(
  '/:id',
  requirePermission('branches:manage'),
  asyncHandler(async (req, res) => {
    await service.deleteBranch(req.tenantId, Number(req.params.id), req);
    res.status(204).end();
  })
);

module.exports = router;
