const express = require('express');
const { config } = require('../../config');
const { logger } = require('../../logger');
const mpProvider = require('./providers/mercadopago.provider');
const svc = require('./payments.service');

// Webhook de MercadoPago — necesita el body CRUDO para poder validar la
// firma x-signature (por eso se monta con express.raw ANTES de
// express.json en server.js). MercadoPago espera 200 rápido: cualquier
// error nuestro responde 200 igual (evita una tormenta de reintentos por
// algo que no se va a resolver reintentando) — la única excepción es una
// firma inválida, que sí se rechaza con 401.
function buildWebhookRouter() {
  const router = express.Router();

  router.post('/mercadopago', express.raw({ type: '*/*' }), async (req, res) => {
    try {
      const xSignature = req.headers['x-signature'];
      const xRequestId = req.headers['x-request-id'];
      const dataId = req.query['data.id'] || req.query.id;
      const topic = req.query.type || req.query.topic;

      const secret = config.mercadopago.webhookSecret;
      let signatureOk = false;
      if (secret) {
        signatureOk = mpProvider.verifyWebhookSignature({ xSignature, xRequestId, dataId, secret });
        if (!signatureOk) {
          logger.warn('mp_webhook_bad_signature', { xRequestId, dataId });
          return res.status(401).json({ error: 'Firma inválida.' });
        }
      } else {
        logger.warn('mp_webhook_no_secret', { note: 'MP_WEBHOOK_SECRET no configurado — aceptando SIN validar firma (sólo aceptable en desarrollo)' });
      }

      if (!dataId) return res.status(200).json({ ok: true }); // notificación sin id de recurso: nada que hacer

      const result = await svc.processMpWebhookNotification({ dataId: String(dataId), topic, signatureOk: !!secret ? signatureOk : true });
      res.status(200).json({ ok: true, duplicate: !!result.duplicate });
    } catch (err) {
      logger.error('mp_webhook_error', { message: err.message, stack: err.stack });
      res.status(200).json({ ok: false }); // ver comentario de arriba
    }
  });

  return router;
}

module.exports = { buildWebhookRouter };
