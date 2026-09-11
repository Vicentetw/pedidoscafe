const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./promotions.schema');
const svc = require('./promotions.service');

// Promociones — back-office. Bajo /api/promotions, tenant obligatorio. Ver
// es promotions:view; crear/editar reglas/activar-desactivar es
// promotions:manage. Aplicar una promo a un pedido vive en orders.routes.js
// (es orders:amend, no esto — ver el comentario ahí).
const router = express.Router();
router.use(requireTenantId);

router.get('/', requirePermission('promotions:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listPromotions(req.tenantId, { status: req.query.status }) })));
router.post('/', requirePermission('promotions:manage'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createPromotion(req.tenantId, s.createPromotion.parse(req.body), req))));
router.get('/:id', requirePermission('promotions:view'), asyncHandler(async (req, res) =>
  res.json(await svc.getPromotion(req.tenantId, +req.params.id))));

router.post('/:id/rules', requirePermission('promotions:manage'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.addRule(req.tenantId, +req.params.id, s.createRule.parse(req.body), req))));
router.put('/:id/status', requirePermission('promotions:manage'), asyncHandler(async (req, res) =>
  res.json(await svc.setStatus(req.tenantId, +req.params.id, s.setStatus.parse(req.body).status, req))));

module.exports = router;
