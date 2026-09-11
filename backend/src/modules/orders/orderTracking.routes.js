const express = require('express');
const asyncHandler = require('../../http/asyncHandler');
const { handleOrderTrackingStream } = require('../../http/sse');
const ordersRepo = require('./orders.repository');
const branchRepo = require('../platform/branches.repository');
const devicesRepo = require('../devices/devices.repository');
const { NotFoundError } = require('../../errors');

// Seguimiento público de UN pedido — sin login (Fase 13, modo mostrador:
// prompt.txt §22 "aviso digital en teléfono"). El public_id (ULID) del
// pedido ES la credencial: igual que un token de QR, sólo quien lo tiene
// (impreso en el ticket, o en un link) puede consultarlo. Nunca expone más
// que lo necesario para saber si el pedido está listo.
const router = express.Router();

async function resolveOrder(req, res, next) {
  const order = await ordersRepo.findByPublicIdAny(req.params.publicId);
  if (!order) throw new NotFoundError('Ese pedido no existe o el link ya venció.');
  req.orderTracking = { tenantId: order.tenant_id, orderPublicId: order.public_id, order };
  next();
}

router.get('/:publicId/status', asyncHandler(resolveOrder), asyncHandler(async (req, res) => {
  const { order } = req.orderTracking;
  const branch = await branchRepo.findById(order.tenant_id, order.branch_id);
  const assignment = await devicesRepo.findActiveAssignmentForOrder(order.tenant_id, order.id);
  res.json({
    status: order.status,
    channel: order.channel,
    branchName: branch?.name ?? null,
    deviceCode: assignment?.code ?? null,
    readyAt: order.ready_at,
  });
}));

router.get('/:publicId/stream', asyncHandler(resolveOrder), handleOrderTrackingStream);

module.exports = router;
