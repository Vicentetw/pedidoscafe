const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./devices.schema');
const svc = require('./devices.service');

// Dispositivos — back-office. Bajo /api/devices, tenant obligatorio.
// Asignar/liberar un dispositivo en un pedido vive en orders.routes.js (es
// una acción sobre el pedido, mismo criterio que aplicar una promoción).
const router = express.Router();
router.use(requireTenantId);

router.get('/', requirePermission('devices:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listDevices(req.tenantId, { branchId: req.query.branchId ? +req.query.branchId : null }) })));
router.post('/', requirePermission('devices:manage'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createDevice(req.tenantId, s.createDevice.parse(req.body), req))));
router.put('/:id/status', requirePermission('devices:manage'), asyncHandler(async (req, res) =>
  res.json(await svc.setStatus(req.tenantId, +req.params.id, s.setStatus.parse(req.body).status, req))));

module.exports = router;
