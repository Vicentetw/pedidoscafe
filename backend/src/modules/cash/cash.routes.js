const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./cash.schema');
const svc = require('./cash.service');

// Caja física — back-office. Bajo /api/cash, tenant obligatorio.
const router = express.Router();
router.use(requireTenantId);

router.get('/registers', requirePermission('cash:view'), asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? +req.query.branchId : null;
  if (!branchId) return res.status(400).json({ error: 'Indicá ?branchId=.', code: 'BRANCH_REQUIRED' });
  res.json({ data: await svc.listRegisters(req.tenantId, branchId) });
}));
router.post('/registers', requirePermission('cash:manage'), asyncHandler(async (req, res) => {
  const branchId = +req.query.branchId;
  res.status(201).json(await svc.createRegister(req.tenantId, branchId, s.createRegister.parse(req.body), req));
}));
router.post('/registers/:id/open', requirePermission('cash:open'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.openRegister(req.tenantId, +req.params.id, s.openRegister.parse(req.body).openingAmount, req))));

router.get('/sessions/open', requirePermission('cash:view'), asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? +req.query.branchId : null;
  if (!branchId) return res.status(400).json({ error: 'Indicá ?branchId=.', code: 'BRANCH_REQUIRED' });
  res.json({ data: await svc.listOpenSessions(req.tenantId, branchId) });
}));
router.get('/sessions/:id', requirePermission('cash:view'), asyncHandler(async (req, res) => res.json(await svc.getSession(req.tenantId, +req.params.id))));
router.post('/sessions/:id/movement', requirePermission('cash:movement'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.addMovement(req.tenantId, +req.params.id, s.addMovement.parse(req.body), req))));
router.post('/sessions/:id/close', requirePermission('cash:close'), asyncHandler(async (req, res) =>
  res.json(await svc.closeRegisterSession(req.tenantId, +req.params.id, s.closeSession.parse(req.body).closingAmount, req))));

module.exports = router;
