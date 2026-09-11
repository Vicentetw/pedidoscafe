const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { countryFirewall } = require('../../http/countryFirewall');
const { requireTurnstile } = require('../../http/turnstile');
const s = require('./tables.schema');
const svc = require('./tables.service');

// Superficie del comensal SIN login. Montada bajo /api/public (salta las 3
// capas de identidad). El QR sólo lleva un token opaco; el backend resuelve
// tenant/branch/table y emite el table_session_token (JWT).
const router = express.Router();

// GET /api/public/qr/:token/resolve  -> qué mesa es (sin nada sensible)
router.get(
  '/qr/:token/resolve',
  asyncHandler(async (req, res) => {
    res.json(await svc.resolveQr(req.params.token));
  })
);

// POST /api/public/table-sessions  -> crea/recupera la sesión + suma participante
router.post(
  '/table-sessions',
  countryFirewall,
  requireTurnstile,
  asyncHandler(async (req, res) => {
    const input = s.startSessionPublic.parse(req.body); // NO lee tenant/branch/table/price
    res.status(201).json(await svc.startSession(input.qrToken, input, req));
  })
);

module.exports = router;
