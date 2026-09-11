const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./catalog.schema');
const svc = require('./catalog.service');

// Catálogo — back-office. Todo bajo /api/catalog, con tenant obligatorio.
// GET => catalog:view · mutaciones => catalog:manage · precio => catalog:update_price
const router = express.Router();
router.use(requireTenantId);

const view = requirePermission('catalog:view');
const manage = requirePermission('catalog:manage');

// -------- menús
router.get('/menus', view, asyncHandler(async (req, res) => res.json({ data: await svc.listMenus(req.tenantId) })));
router.post('/menus', manage, asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createMenu(req.tenantId, s.createMenu.parse(req.body), req))));
router.patch('/menus/:id', manage, asyncHandler(async (req, res) =>
  res.json(await svc.updateMenu(req.tenantId, +req.params.id, s.updateMenu.parse(req.body), req))));
router.delete('/menus/:id', manage, asyncHandler(async (req, res) => {
  await svc.deleteMenu(req.tenantId, +req.params.id, req);
  res.status(204).end();
}));

// -------- categorías
router.get('/menus/:menuId/categories', view, asyncHandler(async (req, res) =>
  res.json({ data: await svc.listCategories(req.tenantId, +req.params.menuId) })));
router.post('/categories', manage, asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createCategory(req.tenantId, s.createCategory.parse(req.body), req))));
router.patch('/categories/:id', manage, asyncHandler(async (req, res) =>
  res.json(await svc.updateCategory(req.tenantId, +req.params.id, s.updateCategory.parse(req.body), req))));
router.delete('/categories/:id', manage, asyncHandler(async (req, res) => {
  await svc.deleteCategory(req.tenantId, +req.params.id, req);
  res.status(204).end();
}));

// -------- productos
router.get('/products', view, asyncHandler(async (req, res) =>
  res.json({ data: await svc.listProducts(req.tenantId, { categoryId: req.query.categoryId ? +req.query.categoryId : undefined }) })));
router.get('/products/:id', view, asyncHandler(async (req, res) => res.json(await svc.getProduct(req.tenantId, +req.params.id))));
router.post('/products', manage, asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createProduct(req.tenantId, s.createProduct.parse(req.body), req))));
router.patch('/products/:id', manage, asyncHandler(async (req, res) =>
  res.json(await svc.updateProduct(req.tenantId, +req.params.id, s.updateProduct.parse(req.body), req))));
router.put('/products/:id/price', requirePermission('catalog:update_price'), asyncHandler(async (req, res) =>
  res.json(await svc.updateProductPrice(req.tenantId, +req.params.id, s.updatePrice.parse(req.body).basePrice, req))));
router.put('/products/:id/branch-override', manage, asyncHandler(async (req, res) =>
  res.json({ data: await svc.setBranchOverride(req.tenantId, +req.params.id, s.branchOverride.parse(req.body), req) })));
router.delete('/products/:id', manage, asyncHandler(async (req, res) => {
  await svc.deleteProduct(req.tenantId, +req.params.id, req);
  res.status(204).end();
}));

// -------- variantes
router.post('/products/:id/variants', manage, asyncHandler(async (req, res) =>
  res.status(201).json({ data: await svc.addVariant(req.tenantId, +req.params.id, s.createVariant.parse(req.body), req) })));
router.delete('/products/:pid/variants/:id', manage, asyncHandler(async (req, res) => {
  await svc.removeVariant(req.tenantId, +req.params.pid, +req.params.id, req);
  res.status(204).end();
}));
router.put('/products/:id/modifier-groups', manage, asyncHandler(async (req, res) => {
  await svc.setProductModifierGroups(req.tenantId, +req.params.id, s.setModifierGroups.parse(req.body).groupIds, req);
  res.status(204).end();
}));
router.put('/products/:id/tags', manage, asyncHandler(async (req, res) => {
  await svc.setProductTags(req.tenantId, +req.params.id, s.setTags.parse(req.body).tagIds, req);
  res.status(204).end();
}));

// -------- grupos de modificadores / tags
router.get('/modifier-groups', view, asyncHandler(async (req, res) => res.json({ data: await svc.listModifierGroups(req.tenantId) })));
router.post('/modifier-groups', manage, asyncHandler(async (req, res) =>
  res.status(201).json({ id: await svc.createModifierGroup(req.tenantId, s.createModifierGroup.parse(req.body), req) })));
router.post('/modifier-groups/:id/modifiers', manage, asyncHandler(async (req, res) =>
  res.status(201).json({ id: await svc.addModifier(req.tenantId, +req.params.id, s.createModifier.parse(req.body), req) })));
router.get('/tags', view, asyncHandler(async (req, res) => res.json({ data: await svc.listTags(req.tenantId) })));
router.post('/tags', manage, asyncHandler(async (req, res) =>
  res.status(201).json({ id: await svc.createTag(req.tenantId, s.createTag.parse(req.body), req) })));

module.exports = router;
