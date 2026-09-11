const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { tableSessionMiddleware } = require('../../auth/sessionToken');
const { handleGuestStream } = require('../../http/sse');
const s = require('./tables.schema');
const svc = require('./tables.service');

// Endpoints del comensal YA en una sesión de mesa. Bajo /api/session,
// gateados por el table_session_token (JWT) — NO por Firebase. El scope
// (tenant/branch/table/session/participant) sale del token, nunca del body.
const router = express.Router();

// El stream se engancha antes del parser de errores para poder escribir SSE.
router.get('/stream', tableSessionMiddleware, handleGuestStream);

router.use(tableSessionMiddleware);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await svc.getGuestSession(req.tableSession));
  })
);

router.post(
  '/participants',
  asyncHandler(async (req, res) => {
    const input = s.addParticipant.parse(req.body);
    res.status(201).json(await svc.addGuestParticipant(req.tableSession, input));
  })
);

router.delete(
  '/participants/:publicId',
  asyncHandler(async (req, res) => {
    res.json(await svc.removeGuestParticipant(req.tableSession, req.params.publicId));
  })
);

router.put(
  '/order-mode',
  asyncHandler(async (req, res) => {
    const { orderMode } = s.setOrderMode.parse(req.body);
    res.json(await svc.setOrderMode(req.tableSession, orderMode));
  })
);

module.exports = router;
