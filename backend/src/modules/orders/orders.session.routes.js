const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { tableSessionMiddleware } = require('../../auth/sessionToken');
const { ForbiddenError, NotFoundError } = require('../../errors');
const s = require('./orders.schema');
const svc = require('./orders.service');
const repo = require('./orders.repository');

// Pedidos del COMENSAL — bajo /api/session/orders, gateado por el
// table_session_token. El scope (tenant/branch/session/participant) sale
// del token; el body sólo trae códigos de producto y cantidades.
const router = express.Router();
router.use(tableSessionMiddleware);

const guestActor = (req) => ({ kind: 'guest', actorId: null, req });

// Un pedido debe pertenecer a MI sesión, y para editarlo, a MÍ (participante).
async function myOrder(req, { mustBeMine = true } = {}) {
  const ts = req.tableSession;
  const order = await repo.findOrder(ts.tenantId, +req.params.id);
  if (!order || order.session_id !== ts.sessionId) throw new NotFoundError('Ese pedido no existe.');
  if (mustBeMine && order.participant_id !== ts.participantId) {
    throw new ForbiddenError('Ese pedido es de otra persona de la mesa.');
  }
  return order;
}

router.get('/orders', asyncHandler(async (req, res) => {
  res.json(await svc.listGuestOrders(req.tableSession));
}));

router.post('/orders', asyncHandler(async (req, res) => {
  const ts = req.tableSession;
  const input = s.createOrderGuest.parse(req.body);
  res.status(201).json(await svc.createOrder(ts.tenantId, {
    branchId: ts.branchId, sessionId: ts.sessionId, participantId: ts.participantId, channel: 'TABLE', note: input.note,
  }, { kind: 'guest', actorId: null }));
}));

router.get('/orders/:id', asyncHandler(async (req, res) => {
  await myOrder(req, { mustBeMine: false });
  res.json(await svc.getOrder(req.tableSession.tenantId, +req.params.id));
}));

router.post('/orders/:id/items', asyncHandler(async (req, res) => {
  await myOrder(req);
  res.status(201).json(await svc.addItem(req.tableSession.tenantId, +req.params.id, s.itemInput.parse(req.body), guestActor(req)));
}));
router.patch('/orders/:id/items/:itemId', asyncHandler(async (req, res) => {
  await myOrder(req);
  res.json(await svc.updateItem(req.tableSession.tenantId, +req.params.id, +req.params.itemId, s.updateItem.parse(req.body), guestActor(req)));
}));
router.delete('/orders/:id/items/:itemId', asyncHandler(async (req, res) => {
  await myOrder(req);
  await svc.removeItem(req.tableSession.tenantId, +req.params.id, +req.params.itemId, guestActor(req));
  res.status(204).end();
}));

router.post('/orders/:id/submit', asyncHandler(async (req, res) => {
  await myOrder(req);
  res.json(await svc.submitOrder(req.tableSession.tenantId, +req.params.id, guestActor(req)));
}));

// "Ya terminamos de pedir" — confirma TODOS los pedidos sin confirmar de
// la mesa (no sólo los míos), para avisarle a cocina de una vez.
router.post('/orders/close-all', asyncHandler(async (req, res) => {
  const ts = req.tableSession;
  res.json(await svc.submitAllDraftsInSession(ts.tenantId, ts.sessionId, guestActor(req)));
}));

router.post('/orders/:id/cancel', asyncHandler(async (req, res) => {
  await myOrder(req);
  const { reason } = s.cancelOrder.parse(req.body);
  res.json(await svc.cancelOrder(req.tableSession.tenantId, +req.params.id, { reason }, guestActor(req)));
}));

module.exports = router;
