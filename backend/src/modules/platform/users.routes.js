const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const { UnauthorizedError } = require('../../errors');
const schema = require('./users.schema');
const service = require('./users.service');

const router = express.Router();

// Perfil propio — cualquier usuario habilitado, con o sin empresa
// (el superadmin no tiene tenant). Lo llama el frontend al arrancar.
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.appUser) throw new UnauthorizedError();
    res.json(await service.getMe(req));
  })
);

// Gestión de usuarios de la empresa — requiere tenant + permiso de staff.
router.get(
  '/',
  requireTenantId,
  requirePermission('staff:view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await service.listUsers(req.tenantId) });
  })
);

router.post(
  '/',
  requireTenantId,
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const input = schema.inviteUser.parse(req.body);
    res.status(201).json(await service.inviteUser(req.tenantId, input, req));
  })
);

router.patch(
  '/:id',
  requireTenantId,
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const patch = schema.updateUser.parse(req.body);
    res.json(await service.updateUser(req.tenantId, Number(req.params.id), patch, req));
  })
);

module.exports = router;
