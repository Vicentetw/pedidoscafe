const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./crm.schema');
const svc = require('./crm.service');

// CRM — back-office. Bajo /api/crm, tenant obligatorio. Ver reusa crm:view
// (mozo/cajero/encargado también lo tienen — pueden buscar un cliente al
// tomar un pedido); crear/editar/linkear reusa crm:manage (sólo dueño/admin,
// datos personales de clientes son más sensibles que ver el menú).
const router = express.Router();
router.use(requireTenantId);

router.get('/customers', requirePermission('crm:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listCustomers(req.tenantId, { search: req.query.search }) })));
router.post('/customers', requirePermission('crm:manage'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.createCustomer(req.tenantId, s.createCustomer.parse(req.body), req))));
router.get('/customers/:id', requirePermission('crm:view'), asyncHandler(async (req, res) =>
  res.json(await svc.getCustomer(req.tenantId, +req.params.id))));
router.put('/customers/:id', requirePermission('crm:manage'), asyncHandler(async (req, res) =>
  res.json(await svc.updateCustomer(req.tenantId, +req.params.id, s.updateCustomer.parse(req.body), req))));

router.get('/customers/:id/preferences', requirePermission('crm:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listPreferences(req.tenantId, +req.params.id) })));
router.put('/customers/:id/preferences/:key', requirePermission('crm:manage'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.setPreference(req.tenantId, +req.params.id, req.params.key, s.setPreference.parse(req.body).value, req) })));

router.get('/customers/:id/orders', requirePermission('crm:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.listOrders(req.tenantId, +req.params.id) })));
router.post('/customers/:id/link-participant', requirePermission('crm:manage'), asyncHandler(async (req, res) =>
  res.json(await svc.linkParticipant(req.tenantId, +req.params.id, s.linkParticipant.parse(req.body).participantId, req))));

module.exports = router;
