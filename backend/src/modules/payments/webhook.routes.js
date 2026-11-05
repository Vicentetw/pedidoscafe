const express = require('express');
const { config } = require('../../config');
const { logger } = require('../../logger');
const mpProvider = require('./providers/mercadopago.provider');
const svc = require('./payments.service');

// Webhook de MercadoPago — necesita el body CRUDO para poder validar la
// firma x-signature (por eso se monta con express.raw ANTES de
// express.json en server.js). Duplicados y pagos que no son nuestros
// responden 200; firma inválida 401; un error al procesar 500, para que
// MercadoPago reintente (antes respondía 200 y el aviso se perdía).
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
      // sólo se procesan avisos de pagos (merchant_order y otros tópicos: nada que hacer)
      if (topic && topic !== 'payment') return res.status(200).json({ ok: true, ignored: true });

      const result = await svc.processMpWebhookNotification({ dataId: String(dataId), topic, signatureOk: !!secret ? signatureOk : true });
      res.status(200).json({ ok: true, duplicate: !!result.duplicate });
    } catch (err) {
      // MercadoPago no conoce ese pago (p. ej. el aviso de prueba del panel):
      // reintentar no lo va a resolver.
      if (err.code === 'MP_FETCH_FAILED' && err.details?.httpStatus === 404) {
        logger.warn('mp_webhook_unknown_payment', { message: err.message });
        return res.status(200).json({ ok: false, ignored: true });
      }
      logger.error('mp_webhook_error', { message: err.message, stack: err.stack });
      // 500 para que MercadoPago reintente: la transacción se deshizo y la
      // notificación no quedó registrada, así que el reintento se procesa.
      res.status(500).json({ ok: false });
    }
  });

  return router;
}

module.exports = { buildWebhookRouter };
