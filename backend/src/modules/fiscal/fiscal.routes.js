const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./fiscal.schema');
const svc = require('./fiscal.service');

// Fiscal — back-office. Bajo /api/fiscal, tenant obligatorio. Config y
// alícuotas reusan settings:*; emitir un comprobante reusa payments:charge
// (quien puede cobrar puede darle el ticket); listar reusa payments:view.
const router = express.Router();
router.use(requireTenantId);

router.get('/config', requirePermission('settings:view'), asyncHandler(async (req, res) =>
  res.json(await svc.getConfig(req.tenantId, +req.query.branchId))));
router.put('/config', requirePermission('settings:manage'), asyncHandler(async (req, res) =>
  res.json(await svc.setConfig(req.tenantId, +req.query.branchId, s.setConfig.parse(req.body), req))));

router.get('/tax-rates', requirePermission('settings:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listTaxRates(req.tenantId) })));
router.post('/tax-rates', requirePermission('settings:manage'), asyncHandler(async (req, res) =>
  res.status(201).json({ id: await svc.createTaxRate(req.tenantId, s.createTaxRate.parse(req.body), req) })));

router.get('/documents', requirePermission('payments:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listDocuments(req.tenantId, +req.query.branchId) })));
router.get('/documents/:id', requirePermission('payments:view'), asyncHandler(async (req, res) =>
  res.json(await svc.getDocument(req.tenantId, +req.params.id))));

router.post('/orders/:orderId/issue', requirePermission('payments:charge'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.issueForOrder(req.tenantId, +req.params.orderId, s.issueDocument.parse(req.body), { actorId: req.appUser?.id ?? null, req }))));
router.post('/sessions/:sessionId/issue', requirePermission('payments:charge'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.issueForSession(req.tenantId, +req.params.sessionId, s.issueDocument.parse(req.body), { actorId: req.appUser?.id ?? null, req }))));

module.exports = router;
