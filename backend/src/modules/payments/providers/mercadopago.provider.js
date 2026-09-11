// Adapter MercadoPago para el cobro al COMENSAL (distinto del preapproval
// de la suscripción SaaS del dueño — ver INSTRUCCIONES.md §3.4). La firma
// del webhook (`verifyWebhookSignature`) es la MISMA fórmula que ya usa y
// tiene probada el sistema de asistencia
// (motor-laboral/services/mercadopagoService.js) — reusada tal cual.
//
// Elección de implementación: se usa la API de **Preferences / Checkout
// Pro** (`POST /checkout/preferences`), no la Orders API todavía. Es la
// integración de pagos online más estable y documentada de MercadoPago, y
// la que se puede validar estructuralmente sin credenciales reales en este
// entorno. Migrar a Orders API / QR dinámico (Point) es un cambio de
// adapter, no del resto del sistema — `payments.service.js` sólo conoce
// esta interfaz (`createCheckout` / `fetchPaymentStatus` / `refund` /
// `verifyWebhookSignature`).
//
// Todas las llamadas de red reciben `fetchImpl` inyectable (default: fetch
// global) para poder testear sin pegarle a MercadoPago de verdad — mismo
// patrón que mercadopagoService.js.
const crypto = require('crypto');
const { config } = require('../../../config');
const { DomainError } = require('../../../errors');

const MP_API_BASE = 'https://api.mercadopago.com';

function assertConfigured() {
  if (!config.mercadopago.accessToken) {
    throw new DomainError('MercadoPago no está configurado en el backend.', {
      status: 503, code: 'MP_NOT_CONFIGURED',
    });
  }
}

/**
 * @param {{ externalReference:string, amount:string, description:string,
 *           notificationUrl?:string, fetchImpl?:Function }} args
 * @returns {Promise<{ providerRef:string, initPoint:string }>}
 */
async function createCheckout({ externalReference, amount, description, notificationUrl, fetchImpl = fetch }) {
  assertConfigured();
  const body = {
    external_reference: externalReference,
    notification_url: notificationUrl || undefined,
    items: [
      {
        title: (description || 'Consumo').slice(0, 250),
        quantity: 1,
        unit_price: Number(amount),
        currency_id: 'ARS',
      },
    ],
  };
  const res = await fetchImpl(`${MP_API_BASE}/checkout/preferences`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.mercadopago.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new DomainError('MercadoPago rechazó la solicitud de cobro. Probá de nuevo en un momento.', {
      status: 502, code: 'MP_CHECKOUT_FAILED', details: { mpResponse: json },
    });
  }
  return { providerRef: json.id, initPoint: json.init_point };
}

/** Re-consulta el estado REAL de un pago — nunca se confía en el payload del webhook a secas. */
async function fetchPaymentStatus(mpPaymentId, { fetchImpl = fetch } = {}) {
  assertConfigured();
  const res = await fetchImpl(`${MP_API_BASE}/v1/payments/${mpPaymentId}`, {
    headers: { Authorization: `Bearer ${config.mercadopago.accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new DomainError('No se pudo confirmar el pago con MercadoPago.', { status: 502, code: 'MP_FETCH_FAILED' });
  }
  return {
    id: String(json.id),
    status: json.status, // approved | pending | rejected | cancelled | refunded | in_process
    statusDetail: json.status_detail,
    externalReference: json.external_reference,
    amount: json.transaction_amount,
    currency: json.currency_id,
  };
}

// Búsqueda por external_reference (el que generamos nosotros) — a
// diferencia de fetchPaymentStatus, que necesita el ID de pago de
// MercadoPago (algo que sólo nos llega por webhook). Sirve para poder
// confirmar un cobro SIN depender de que el webhook nos haya alcanzado
// (típico en desarrollo local, sin URL pública) — ver
// payments.service.checkPendingMpPayment.
async function findPaymentByExternalReference(externalReference, { fetchImpl = fetch } = {}) {
  assertConfigured();
  const url = `${MP_API_BASE}/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}&sort=date_created&criteria=desc`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.mercadopago.accessToken}` } });
  const json = await res.json();
  if (!res.ok) {
    throw new DomainError('No se pudo consultar el pago con MercadoPago.', { status: 502, code: 'MP_FETCH_FAILED' });
  }
  const found = (json.results || [])[0];
  if (!found) return null;
  return {
    id: String(found.id),
    status: found.status,
    statusDetail: found.status_detail,
    externalReference: found.external_reference,
    amount: found.transaction_amount,
    currency: found.currency_id,
  };
}

async function refund(mpPaymentId, amount, { fetchImpl = fetch } = {}) {
  assertConfigured();
  const res = await fetchImpl(`${MP_API_BASE}/v1/payments/${mpPaymentId}/refunds`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.mercadopago.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(amount != null ? { amount: Number(amount) } : {}),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new DomainError('MercadoPago rechazó la devolución.', { status: 502, code: 'MP_REFUND_FAILED', details: { mpResponse: json } });
  }
  return { providerRef: String(json.id), status: json.status };
}

// Fórmula verificada contra la documentación oficial de MercadoPago (y ya
// probada en producción por el sistema de asistencia):
//   manifest = "id:{dataId};request-id:{xRequestId};ts:{ts};"
//   HMAC-SHA256 hex del manifest con el webhook secret, comparado en
//   tiempo constante contra el v1 del header x-signature.
function verifyWebhookSignature({ xSignature, xRequestId, dataId, secret }) {
  if (!xSignature || !xRequestId || !dataId || !secret) return false;
  const parts = Object.fromEntries(
    xSignature.split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k?.trim(), v?.trim()];
    })
  );
  const { ts, v1 } = parts;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(v1, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

module.exports = { createCheckout, fetchPaymentStatus, findPaymentByExternalReference, refund, verifyWebhookSignature, PROVIDER: 'MERCADOPAGO' };
