const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./orders.schema');
const svc = require('./kitchen.service');

// KDS + setup de estaciones. Bajo /api/kitchen, tenant obligatorio.
// Setup (estaciones/ruteo) -> tables:manage · tablero -> kitchen:view ·
// avanzar -> kitchen:advance_ticket.
const router = express.Router();
router.use(requireTenantId);

const setup = requirePermission('tables:manage');

router.get('/stations', requirePermission('kitchen:view'), asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? +req.query.branchId : null;
  if (!branchId) return res.status(400).json({ error: 'Indicá ?branchId=.', code: 'BRANCH_REQUIRED' });
  res.json({ data: await svc.listStations(req.tenantId, branchId) });
}));
router.post('/stations', setup, asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createStation(req.tenantId, s.createStation.parse(req.body), req))));
router.delete('/stations/:id', setup, asyncHandler(async (req, res) => {
  await svc.deleteStation(req.tenantId, +req.params.id, req);
  res.status(204).end();
}));

router.get('/routing', setup, asyncHandler(async (req, res) => {
  const branchId = +req.query.branchId;
  res.json({ data: await svc.listRouting(req.tenantId, branchId) });
}));
router.put('/routing', setup, asyncHandler(async (req, res) => {
  const input = s.setRouting.parse(req.body);
  const branchId = +req.query.branchId;
  res.json({ data: await svc.setRouting(req.tenantId, branchId, input, req) });
}));
router.delete('/routing/:id', setup, asyncHandler(async (req, res) => {
  await svc.deleteRouting(req.tenantId, +req.params.id, req);
  res.status(204).end();
}));

router.get('/tickets', requirePermission('kitchen:view'), asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? +req.query.branchId : null;
  if (!branchId) return res.status(400).json({ error: 'Indicá ?branchId=.', code: 'BRANCH_REQUIRED' });
  res.json({ data: await svc.board(req.tenantId, branchId, {
    stationId: req.query.stationId ? +req.query.stationId : undefined,
    status: req.query.status || undefined,
  }) });
}));

router.post('/tickets/:id/advance', requirePermission('kitchen:advance_ticket'), asyncHandler(async (req, res) =>
  res.json(await svc.advanceTicket(req.tenantId, +req.params.id, req, req.appUser?.id ?? null))));

module.exports = router;
