const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./orders.schema');
const svc = require('./orders.service');
const promotionsSvc = require('../promotions/promotions.service');
const devicesSvc = require('../devices/devices.service');
const devicesSchema = require('../devices/devices.schema');

// Pedidos — back-office / mostrador. Bajo /api/orders, tenant obligatorio.
const router = express.Router();
router.use(requireTenantId);

const staffActor = (req, extra = {}) => ({
  kind: 'staff', actorId: req.appUser?.id ?? null, req,
  // Modificar un pedido YA confirmado (agregar/sacar ítem) exige este
  // permiso además del de siempre (orders:create/orders:amend) — se
  // computa acá una sola vez y orders.service.js lo mira en assertEditable.
  canAmendPaid: !!(req.appUser?.isSuperadmin || req.appUser?.permissions?.has('orders:amend_paid')),
  ...extra,
});

router.get('/', requirePermission('orders:view'), asyncHandler(async (req, res) => {
  const { branchId, sessionId, status } = req.query;
  res.json({ data: await svc.listOrders(req.tenantId, {
    branchId: branchId ? +branchId : undefined,
    sessionId: sessionId ? +sessionId : undefined,
    status: status || undefined,
  }) });
}));

router.get('/:id', requirePermission('orders:view'), asyncHandler(async (req, res) =>
  res.json(await svc.getOrder(req.tenantId, +req.params.id))));

router.get('/:id/events', requirePermission('orders:view'), asyncHandler(async (req, res) =>
  res.json({ data: await svc.getOrderEvents(req.tenantId, +req.params.id) })));

router.post('/', requirePermission('orders:create'), asyncHandler(async (req, res) => {
  const input = s.createOrderStaff.parse(req.body);
  res.status(201).json(await svc.createOrder(req.tenantId, {
    branchId: input.branchId, sessionId: input.sessionId ?? null, customerId: input.customerId ?? null,
    channel: input.channel, note: input.note,
  }, { kind: 'staff', actorId: req.appUser?.id ?? null }));
}));

router.post('/:id/items', requirePermission('orders:create'), asyncHandler(async (req, res) =>
  res.status(201).json(await svc.addItem(req.tenantId, +req.params.id, s.itemInput.parse(req.body), staffActor(req)))));
router.patch('/:id/items/:itemId', requirePermission('orders:amend'), asyncHandler(async (req, res) =>
  res.json(await svc.updateItem(req.tenantId, +req.params.id, +req.params.itemId, s.updateItem.parse(req.body), staffActor(req)))));
router.delete('/:id/items/:itemId', requirePermission('orders:amend'), asyncHandler(async (req, res) => {
  await svc.removeItem(req.tenantId, +req.params.id, +req.params.itemId, staffActor(req));
  res.status(204).end();
}));

// Aplicar/sacar una promoción es "modificar el pedido" (su descuento/total)
// — usa orders:amend, no promotions:manage (que es para crear/editar la
// definición de la promoción, no para usarla al tomar un pedido).
router.post('/:id/promotions/:code/apply', requirePermission('orders:amend'), asyncHandler(async (req, res) =>
  res.json(await promotionsSvc.applyPromotion(req.tenantId, +req.params.id, req.params.code, staffActor(req)))));
router.delete('/:id/promotions/:code', requirePermission('orders:amend'), asyncHandler(async (req, res) =>
  res.json(await promotionsSvc.removePromotion(req.tenantId, +req.params.id, req.params.code, staffActor(req)))));

// Modo mostrador (Fase 13, prompt.txt §22): entregar/liberar un buzzer.
router.post('/:id/device', requirePermission('devices:assign'), asyncHandler(async (req, res) =>
  res.status(201).json(await devicesSvc.assignDevice(req.tenantId, +req.params.id, devicesSchema.assignDevice.parse(req.body).deviceCode, staffActor(req)))));
router.delete('/:id/device', requirePermission('devices:assign'), asyncHandler(async (req, res) =>
  res.json(await devicesSvc.releaseDevice(req.tenantId, +req.params.id, staffActor(req)))));

router.post('/:id/submit', requirePermission('orders:create'), asyncHandler(async (req, res) =>
  res.json(await svc.submitOrder(req.tenantId, +req.params.id, staffActor(req)))));

// Equivalente de staff a "ya terminamos de pedir" del comensal — por si el
// mozo tiene que dispararlo él mismo (piden por él, o la app no anda).
router.post('/sessions/:sessionId/submit-all', requirePermission('orders:create'), asyncHandler(async (req, res) =>
  res.json(await svc.submitAllDraftsInSession(req.tenantId, +req.params.sessionId, staffActor(req)))));

router.post('/:id/cancel', requirePermission('orders:cancel'), asyncHandler(async (req, res) => {
  const { reason } = s.cancelOrder.parse(req.body);
  const canAfter = req.appUser?.isSuperadmin || req.appUser?.permissions?.has('orders:cancel_after_prep');
  res.json(await svc.cancelOrder(req.tenantId, +req.params.id, { reason }, staffActor(req, { canCancelAfterPrep: !!canAfter })));
}));

router.post('/:id/priority', requirePermission('orders:set_priority'), asyncHandler(async (req, res) => {
  const { priority } = s.setPriority.parse(req.body);
  res.json(await svc.setPriority(req.tenantId, +req.params.id, priority, staffActor(req)));
}));

router.post('/:id/items/:itemId/age-check', requirePermission('orders:amend'), asyncHandler(async (req, res) => {
  const { result } = s.ageCheck.parse(req.body);
  res.json(await svc.verifyAge(req.tenantId, +req.params.id, +req.params.itemId, result, staffActor(req)));
}));

router.post('/:id/complete', requirePermission('orders:amend'), asyncHandler(async (req, res) =>
  res.json(await svc.completeOrder(req.tenantId, +req.params.id, staffActor(req)))));

module.exports = router;
