const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const s = require('./payments.schema');
const svc = require('./payments.service');

// Pagos — back-office / mostrador. Bajo /api/payments, tenant obligatorio.
const router = express.Router();
router.use(requireTenantId);

const view = requirePermission('payments:view');
const charge = requirePermission('payments:charge');

const staffActor = (req) => ({ actorId: req.appUser?.id ?? null, req });

router.get('/', view, asyncHandler(async (req, res) => {
  const { sessionId, orderId, branchId, status } = req.query;
  res.json({ data: await svc.listPayments(req.tenantId, {
    sessionId: sessionId ? +sessionId : undefined, orderId: orderId ? +orderId : undefined,
    branchId: branchId ? +branchId : undefined, status: status || undefined,
  }) });
}));
router.get('/:id', view, asyncHandler(async (req, res) => res.json(await svc.getPayment(req.tenantId, +req.params.id))));
router.post('/:id/refund', requirePermission('payments:refund'), asyncHandler(async (req, res) =>
  res.json(await svc.refundPayment(req.tenantId, +req.params.id, s.refund.parse(req.body), staffActor(req)))));
// "Verificar pago" — chequeo manual sin depender del webhook (útil en dev
// local, sin URL pública para que MercadoPago nos avise solo).
router.post('/:id/check-mp-status', charge, asyncHandler(async (req, res) =>
  res.json(await svc.checkPendingMpPayment(req.tenantId, +req.params.id, staffActor(req)))));

// -------- mesa
router.get('/sessions/:sessionId/balance', view, asyncHandler(async (req, res) =>
  res.json(await svc.getSessionBalance(req.tenantId, +req.params.sessionId))));
router.post('/sessions/:sessionId/charges', charge, asyncHandler(async (req, res) => {
  const input = s.chargeSessionStaff.parse(req.body);
  if (input.mode === 'INDIVIDUAL' && !input.participantId) return res.status(422).json({ error: 'Falta el participante.', code: 'VALIDATION' });
  if (input.mode === 'SPLIT' && input.amount == null) return res.status(422).json({ error: 'Falta el monto.', code: 'VALIDATION' });
  res.status(201).json(await svc.chargeSession(req.tenantId, +req.params.sessionId, input, staffActor(req)));
}));
router.post('/sessions/:sessionId/split-equal', charge, asyncHandler(async (req, res) => {
  const input = s.splitEqual.parse(req.body);
  res.status(201).json({ data: await svc.splitEqual(req.tenantId, +req.params.sessionId, input.parts, staffActor(req), input.cashSessionId ?? null) });
}));

// -------- mostrador
router.post('/orders/:orderId/charge', charge, asyncHandler(async (req, res) =>
  res.status(201).json(await svc.chargeOrder(req.tenantId, +req.params.orderId, s.chargeOrder.parse(req.body), staffActor(req)))));

// -------- conciliación (Fase 7)
router.get('/reconciliation', requirePermission('payments:view'), asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? +req.query.branchId : null;
  if (!branchId) return res.status(400).json({ error: 'Indicá ?branchId=.', code: 'BRANCH_REQUIRED' });
  res.json(await svc.getReconciliation(req.tenantId, branchId, { staleMinutes: req.query.staleMinutes ? +req.query.staleMinutes : undefined }));
}));

module.exports = router;
