const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./inventory.schema');
const svc = require('./inventory.service');

// Stock — back-office. Bajo /api/inventory, tenant obligatorio.
//   view -> inventory:view · recetas -> inventory:manage_recipes ·
//   ajustes -> inventory:adjust · compras -> inventory:purchase
const router = express.Router();
router.use(requireTenantId);

const view = requirePermission('inventory:view');

// -------- ingredientes
router.get('/ingredients', view, asyncHandler(async (req, res) =>
  res.json({ data: await svc.listIngredients(req.tenantId) })));
router.post('/ingredients', requirePermission('inventory:manage_recipes'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createIngredient(req.tenantId, s.createIngredient.parse(req.body), req))));
router.patch('/ingredients/:id', requirePermission('inventory:manage_recipes'), asyncHandler(async (req, res) =>
  res.json(await svc.updateIngredient(req.tenantId, +req.params.id, s.updateIngredient.parse(req.body), req))));

// -------- recetas (por producto)
router.get('/products/:productId/recipe', view, asyncHandler(async (req, res) =>
  res.json(await svc.getRecipe(req.tenantId, +req.params.productId))));
router.put('/products/:productId/recipe', requirePermission('inventory:manage_recipes'), asyncHandler(async (req, res) =>
  res.json(await svc.setRecipe(req.tenantId, +req.params.productId, s.setRecipe.parse(req.body), req))));

// -------- stock por sucursal
router.get('/stock', view, asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? +req.query.branchId : null;
  if (!branchId) return res.status(400).json({ error: 'Indicá ?branchId=.', code: 'BRANCH_REQUIRED' });
  res.json({ data: await svc.listStock(req.tenantId, branchId) });
}));
router.get('/movements', view, asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? +req.query.branchId : null;
  if (!branchId) return res.status(400).json({ error: 'Indicá ?branchId=.', code: 'BRANCH_REQUIRED' });
  res.json({ data: await svc.listMovements(req.tenantId, branchId, {
    ingredientId: req.query.ingredientId ? +req.query.ingredientId : undefined,
  }) });
}));
router.post('/stock/adjust', requirePermission('inventory:adjust'), asyncHandler(async (req, res) => {
  const branchId = +req.query.branchId;
  res.json(await svc.adjustStock(req.tenantId, branchId, s.adjustStock.parse(req.body), req));
}));
router.put('/stock/reorder-point', requirePermission('inventory:adjust'), asyncHandler(async (req, res) => {
  const branchId = +req.query.branchId;
  await svc.setReorderPoint(req.tenantId, branchId, s.setReorderPoint.parse(req.body), req);
  res.status(204).end();
}));

// -------- compras
router.post('/purchases', requirePermission('inventory:purchase'), asyncHandler(async (req, res) => {
  const branchId = +req.query.branchId;
  res.status(201).json(await svc.createPurchase(req.tenantId, branchId, s.createPurchase.parse(req.body), req));
}));

// -------- proveedores
router.get('/suppliers', view, asyncHandler(async (req, res) => res.json({ data: await svc.listSuppliers(req.tenantId) })));
router.post('/suppliers', requirePermission('inventory:purchase'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createSupplier(req.tenantId, s.createSupplier.parse(req.body), req))));

module.exports = router;
