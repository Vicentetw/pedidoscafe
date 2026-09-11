const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./loyalty.schema');
const svc = require('./loyalty.service');

// Fidelización — back-office. Bajo /api/loyalty, tenant obligatorio. Ver
// cuenta/ledger es loyalty:view; ganar/canjear/ajustar a mano es
// loyalty:adjust ("queda auditado", igual que un ADJUST de stock o caja).
// Niveles y regla de acumulación son configuración del negocio: settings:*
// (mismo criterio que las alícuotas de IVA en la Fase 8).
const router = express.Router();
router.use(requireTenantId);

router.get('/accounts/:customerId', requirePermission('loyalty:view'), asyncHandler(async (req, res) =>
  res.json(await svc.getAccount(req.tenantId, +req.params.customerId))));
router.get('/accounts/:customerId/transactions', requirePermission('loyalty:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listTransactions(req.tenantId, +req.params.customerId) })));

router.post('/accounts/:customerId/earn', requirePermission('loyalty:adjust'), asyncHandler(async (req, res) =>
  res.json(await svc.manualEarn(req.tenantId, +req.params.customerId, s.manualEarn.parse(req.body), { actorId: req.appUser?.id ?? null, req }))));
router.post('/accounts/:customerId/redeem', requirePermission('loyalty:adjust'), asyncHandler(async (req, res) =>
  res.json(await svc.redeem(req.tenantId, +req.params.customerId, s.redeem.parse(req.body), { actorId: req.appUser?.id ?? null, req }))));
router.post('/accounts/:customerId/adjust', requirePermission('loyalty:adjust'), asyncHandler(async (req, res) =>
  res.json(await svc.adjust(req.tenantId, +req.params.customerId, s.adjust.parse(req.body), { actorId: req.appUser?.id ?? null, req }))));

router.get('/tiers', requirePermission('loyalty:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listTiers(req.tenantId) })));
router.post('/tiers', requirePermission('settings:manage'), asyncHandler(async (req, res) =>
  res.status(201).json({ id: await svc.createTier(req.tenantId, s.createTier.parse(req.body), req) })));

router.get('/rules', requirePermission('loyalty:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listRules(req.tenantId) })));
router.post('/rules', requirePermission('settings:manage'), asyncHandler(async (req, res) =>
  res.status(201).json({ id: await svc.createRule(req.tenantId, s.createRule.parse(req.body), req) })));

module.exports = router;
