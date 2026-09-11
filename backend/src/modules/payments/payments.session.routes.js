const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { tableSessionMiddleware } = require('../../auth/sessionToken');
const tablesRepo = require('../tables/tables.repository');
const s = require('./payments.schema');
const svc = require('./payments.service');

// Pagos del COMENSAL — /api/session/payments, gateado por el
// table_session_token. Sólo puede pagar SU parte o toda la mesa, y sólo
// online (el efectivo lo cobra el mostrador). El participantId sale
// SIEMPRE del token, nunca del body.
const router = express.Router();
router.use(tableSessionMiddleware);

router.get('/balance', asyncHandler(async (req, res) => {
  res.json(await svc.getSessionBalance(req.tableSession.tenantId, req.tableSession.sessionId));
}));

router.post('/', asyncHandler(async (req, res) => {
  const ts = req.tableSession;
  const input = s.chargeSessionGuest.parse(req.body);
  let participantId;
  if (input.mode === 'INDIVIDUAL') {
    const me = await tablesRepo.findParticipant(ts.tenantId, ts.sessionId, ts.participantId);
    participantId = me?.public_id;
  }
  const result = await svc.chargeSession(ts.tenantId, ts.sessionId, {
    mode: input.mode, participantId, provider: 'MERCADOPAGO', tipAmount: input.tipAmount,
  }, { actorId: null, req });
  res.status(201).json(result);
}));

module.exports = router;
