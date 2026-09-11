const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./analytics.schema');
const svc = require('./analytics.service');

// Analítica — back-office, sólo lectura de lo que ya generan otros módulos.
// Bajo /api/analytics, tenant obligatorio. Todo gateado con reports:view_sales
// (ya sembrado desde la Fase 1) — recomputar el rollup es igual de inocuo que
// verlo (es derivado, idempotente), así que no exige un permiso más alto.
const router = express.Router();
router.use(requireTenantId);

router.get('/sales-summary', requirePermission('reports:view_sales'), asyncHandler(async (req, res) =>
  res.json(await svc.salesSummary(req.tenantId, s.dateRange.parse(req.query)))));
router.get('/top-products', requirePermission('reports:view_sales'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.topProducts(req.tenantId, s.topProductsQuery.parse(req.query)) })));
router.get('/daily', requirePermission('reports:view_sales'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.dailySeries(req.tenantId, s.dateRange.parse(req.query)) })));

router.post('/rollup/recompute', requirePermission('reports:view_sales'), asyncHandler(async (req, res) =>
  res.json(await svc.recomputeRollup(req.tenantId, s.dateRange.parse(req.body)))));
router.get('/rollup/daily', requirePermission('reports:view_sales'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.getDailyRollup(req.tenantId, s.dateRange.parse(req.query)) })));

module.exports = router;
