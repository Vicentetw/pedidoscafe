const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./tables.schema');
const svc = require('./tables.service');

// Mesas y sesiones — back-office / salón. Bajo /api/tables, tenant obligatorio.
const router = express.Router();
router.use(requireTenantId);

const view = requirePermission('tables:view');
const manage = requirePermission('tables:manage');
const openSess = requirePermission('tables:open_session');

// -------- mesas
router.get('/', view, asyncHandler(async (req, res) =>
  res.json({ data: await svc.listTables(req.tenantId, req.query.branchId ? +req.query.branchId : null) })));
router.get('/:id', view, asyncHandler(async (req, res) => res.json(await svc.getTable(req.tenantId, +req.params.id))));
router.post('/', manage, asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createTable(req.tenantId, s.createTable.parse(req.body), req))));
router.patch('/:id', manage, asyncHandler(async (req, res) =>
  res.json(await svc.updateTable(req.tenantId, +req.params.id, s.updateTable.parse(req.body), req))));
router.delete('/:id', manage, asyncHandler(async (req, res) => {
  await svc.deleteTable(req.tenantId, +req.params.id, req);
  res.status(204).end();
}));
router.post('/:id/qr/rotate', manage, asyncHandler(async (req, res) =>
  res.json(await svc.rotateQr(req.tenantId, +req.params.id, req))));

// -------- sesiones desde el salón
router.get('/sessions/open', view, asyncHandler(async (req, res) =>
  res.json({ data: await svc.listOpenSessions(req.tenantId, req.query.branchId ? +req.query.branchId : null) })));
router.get('/sessions/:id', view, asyncHandler(async (req, res) =>
  res.json(await svc.staffSessionView(req.tenantId, +req.params.id))));
router.post('/sessions', openSess, asyncHandler(async (req, res) => {
  const input = s.openSession.parse(req.body);
  res.status(201).json(await svc.openSessionFromSalon(req.tenantId, input, req));
}));
router.put('/sessions/:id/waiter', requirePermission('tables:assign_waiter'), asyncHandler(async (req, res) => {
  const { waiterUserId } = s.assignWaiter.parse(req.body);
  res.json(await svc.assignWaiter(req.tenantId, +req.params.id, waiterUserId, req));
}));
router.post('/sessions/:id/close', openSess, asyncHandler(async (req, res) =>
  res.json(await svc.closeSession(req.tenantId, +req.params.id, req))));
router.post('/sessions/:id/force-close', requirePermission('tables:force_close'), asyncHandler(async (req, res) => {
  const { reason } = s.closeSession.parse(req.body);
  res.json(await svc.forceCloseSession(req.tenantId, +req.params.id, reason, req));
}));

module.exports = router;
