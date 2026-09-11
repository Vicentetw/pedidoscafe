const pool = require('../../db');
const { config } = require('../../config');
const repo = require('./payments.repository');
const tablesRepo = require('../tables/tables.repository');
const ordersRepo = require('../orders/orders.repository');
const sessionSM = require('../tables/tableSession.stateMachine');
const { assertTransition: assertPaymentTransition, canTransition: canPaymentTransition, SETTLED_LIKE } = require('./payment.stateMachine');
const { toCents, fromCents } = require('../catalog/pricing');
const { withTransaction } = require('../../withTransaction');
const { publish } = require('../../http/sse');
const { enqueue } = require('../../events/outbox');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const mpProvider = require('./providers/mercadopago.provider');
const cashService = require('../cash/cash.service');
const cashRepo = require('../cash/cash.repository');
const loyaltyService = require('../loyalty/loyalty.service');
// El adapter de efectivo no tiene estado propio que consultar: liquida en
// el momento dentro de settleCashPayment(). Se deja documentado acá el
// contrato que comparte con mpProvider (createCheckout) por si el ajuste
// de cuenta pasa a necesitarlo (p. ej. imprimir un comprobante).
require('./providers/cash.provider');

// ============================================================ helpers
function assertPayable(session) {
  if (['CLOSED', 'FORCE_CLOSED'].includes(session.status)) {
    throw new ConflictError('Esta mesa ya está cerrada.');
  }
}

// Sube table_sessions hacia BILL_REQUESTED / PARTIALLY_PAID / PAID según el
// saldo. Corre DENTRO de la transacción que ya tiene la fila lockeada.
async function syncSessionStatus(tenantId, sessionId, conn) {
  const session = await tablesRepo.findSessionById(tenantId, sessionId, conn);
  let cur = session.status;
  if (['OPEN', 'ORDERING', 'SERVING', 'ABANDONED'].includes(cur) && sessionSM.canTransition(cur, 'BILL_REQUESTED')) {
    await tablesRepo.setSessionStatus(tenantId, sessionId, 'BILL_REQUESTED', {}, conn);
    cur = 'BILL_REQUESTED';
  }
  const paid = toCents(session.paid_amount);
  const total = toCents(session.total_amount);
  const target = total > 0 && paid >= total ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : null;
  if (target && target !== cur && sessionSM.canTransition(cur, target)) {
    await tablesRepo.setSessionStatus(tenantId, sessionId, target, {}, conn);
    cur = target;
  }
  return cur;
}

// Aplica un monto ya aprobado al saldo de la mesa. Recalcula el saldo
// FRESCO dentro de la transacción (la fila ya está lockeada por el
// llamador) — así dos pagos concurrentes nunca hacen que paid_amount
// supere total_amount (caso obligatorio 2). Si el monto igual se pasa
// (p. ej. dos aprobaciones de MercadoPago para el mismo saldo), el
// excedente NO se acredita — queda marcado para devolución.
async function applyApprovedAmount(tenantId, sessionId, amountCents, conn) {
  const session = await tablesRepo.findSessionById(tenantId, sessionId, conn);
  const total = toCents(session.total_amount);
  const before = toCents(session.paid_amount);
  let overpayCents = 0;
  let toApply = amountCents;
  if (before + amountCents > total) {
    overpayCents = before + amountCents - total;
    toApply = amountCents - overpayCents;
  }
  await tablesRepo.setSessionAmounts(tenantId, sessionId, fromCents(before + toApply), conn);
  const status = await syncSessionStatus(tenantId, sessionId, conn);
  return { appliedCents: toApply, overpayCents, sessionStatus: status };
}

async function settleCashPayment(tenantId, sessionId, paymentId, amountCents, conn, { cashSessionId, actorId } = {}) {
  await repo.setPaymentStatus(tenantId, paymentId, 'APPROVED', {}, conn);
  await repo.addTransaction(tenantId, paymentId, { type: 'CAPTURE', amount: fromCents(amountCents), status: 'approved' }, conn);
  if (cashSessionId) {
    await cashService.recordCashMovementForPayment(tenantId, cashSessionId, {
      type: 'SALE', amount: fromCents(amountCents), paymentId, actorUserId: actorId ?? null,
    }, conn);
  }
  const applied = await applyApprovedAmount(tenantId, sessionId, amountCents, conn);
  if (applied.overpayCents > 0) {
    await repo.createRefund(tenantId, paymentId, {
      amount: fromCents(applied.overpayCents), status: 'PENDING',
      reason: 'Excedente detectado al aplicar el pago (la mesa ya estaba saldada).',
    }, conn);
  }
  return applied;
}

function computeGroupAmountCents(session) {
  return toCents(session.total_amount) - toCents(session.paid_amount);
}
async function computeIndividualAmountCents(tenantId, sessionId, participantId, conn) {
  const totals = await ordersRepo.totalsByParticipant(tenantId, sessionId, conn);
  const paid = await repo.paidByParticipant(tenantId, sessionId, conn);
  return toCents(totals.get(participantId) || 0) - toCents(paid.get(participantId) || 0);
}

async function getPayment(tenantId, id) {
  const p = await repo.findPayment(tenantId, id);
  if (!p) throw new NotFoundError('Ese pago no existe.');
  const [allocations, transactions] = await Promise.all([repo.listAllocations(tenantId, id), repo.listTransactions(tenantId, id)]);
  return { ...p, allocations, transactions };
}
async function listPayments(tenantId, filters) {
  return repo.listPayments(tenantId, filters);
}

// ============================================================ saldo de la mesa
async function getSessionBalance(tenantId, sessionId) {
  const session = await tablesRepo.findSessionById(tenantId, sessionId);
  if (!session) throw new NotFoundError('Esa mesa no existe.');
  const [totals, paid, participants] = await Promise.all([
    ordersRepo.totalsByParticipant(tenantId, sessionId),
    repo.paidByParticipant(tenantId, sessionId),
    tablesRepo.listParticipants(tenantId, sessionId),
  ]);
  const byParticipant = participants
    .filter((p) => !p.left_at)
    .map((p) => {
      const owedC = toCents(totals.get(p.id) || 0);
      const paidC = toCents(paid.get(p.id) || 0);
      return {
        participantId: p.public_id,
        name: p.nickname || p.display_name,
        owed: fromCents(owedC),
        paid: fromCents(paidC),
        remaining: fromCents(Math.max(0, owedC - paidC)),
      };
    });
  return {
    status: session.status,
    currency: session.currency,
    total: session.total_amount,
    paid: session.paid_amount,
    remaining: fromCents(Math.max(0, computeGroupAmountCents(session))),
    orderMode: session.order_mode,
    byParticipant,
  };
}

// ============================================================ cobrar la mesa
/**
 * @param {{ mode:'GROUP'|'INDIVIDUAL'|'SPLIT', participantId?:number, amount?:string,
 *           provider:'CASH'|'MERCADOPAGO', tipAmount?:string }} input
 */
async function chargeSession(tenantId, sessionId, input, actor) {
  const { mode, provider } = input;
  const step1 = await withTransaction(async (conn) => {
    const session = await tablesRepo.lockSession(tenantId, sessionId, conn);
    if (!session) throw new NotFoundError('Esa mesa no existe.');
    assertPayable(session);

    let amountCents;
    let participantDbId = null;
    if (mode === 'GROUP') {
      amountCents = computeGroupAmountCents(session);
    } else if (mode === 'INDIVIDUAL') {
      const p = await tablesRepo.findParticipantByPublicId(tenantId, sessionId, input.participantId, conn);
      if (!p) throw new ValidationError('Ese participante no existe en esta mesa.');
      participantDbId = p.id;
      amountCents = await computeIndividualAmountCents(tenantId, sessionId, p.id, conn);
    } else if (mode === 'SPLIT') {
      if (!input.amount) throw new ValidationError('Falta el monto.');
      amountCents = toCents(input.amount);
      if (amountCents > computeGroupAmountCents(session)) throw new ValidationError('Ese monto es mayor que el saldo de la mesa.');
    } else {
      throw new ValidationError('Modo de pago inválido.');
    }

    if (amountCents <= 0) {
      throw new ConflictError(mode === 'INDIVIDUAL' ? 'Ya pagaste tu parte.' : 'La mesa ya está saldada.', { code: 'ALREADY_PAID' });
    }

    const kind = mode === 'GROUP' ? 'SESSION_GROUP' : mode === 'INDIVIDUAL' ? 'SESSION_INDIVIDUAL' : 'SESSION_SPLIT';
    const { id: paymentId, externalReference } = await repo.createPayment(tenantId, {
      branchId: session.branch_id, sessionId, kind, provider,
      amount: fromCents(amountCents), tipAmount: input.tipAmount ?? 0, currency: session.currency,
      cashSessionId: provider === 'CASH' ? input.cashSessionId ?? null : null,
      participantId: participantDbId, createdBy: actor.actorId ?? null,
    }, conn);
    await repo.addAllocation(tenantId, paymentId, { participantId: participantDbId, amount: fromCents(amountCents) }, conn);

    if (provider === 'CASH') {
      await settleCashPayment(tenantId, sessionId, paymentId, amountCents, conn, { cashSessionId: input.cashSessionId, actorId: actor.actorId });
      await enqueue(conn, { tenantId, branchId: session.branch_id, type: 'PaymentApproved', payload: { paymentId, sessionId } });
      return { done: true, paymentId, branchId: session.branch_id };
    }
    return { done: false, paymentId, externalReference, amountCents, branchId: session.branch_id, currency: session.currency };
  });

  if (step1.done) {
    await writeAudit({ req: actor.req, tenantId, branchId: step1.branchId, entityType: 'payment', entityId: step1.paymentId, action: 'charge_cash', after: { mode } });
    await notifySession(tenantId, sessionId, step1.branchId);
    return getPayment(tenantId, step1.paymentId);
  }
  return finishMercadoPagoCheckout(tenantId, step1, mode === 'GROUP' ? 'Cuenta de la mesa' : 'Tu parte de la cuenta');
}

// Fuera de la transacción: pedirle el checkout a MercadoPago (no se debe
// tener un lock de fila abierto mientras se espera una llamada de red).
async function finishMercadoPagoCheckout(tenantId, step1, description) {
  try {
    const checkout = await mpProvider.createCheckout({
      externalReference: step1.externalReference,
      amount: fromCents(step1.amountCents),
      description,
      notificationUrl: config.publicBackendUrl ? `${config.publicBackendUrl}/webhooks/mercadopago` : undefined,
    });
    await repo.setPaymentStatus(tenantId, step1.paymentId, 'PENDING', { providerRef: checkout.providerRef });
    const payment = await getPayment(tenantId, step1.paymentId);
    return { ...payment, checkoutUrl: checkout.initPoint };
  } catch (err) {
    await repo.setPaymentStatus(tenantId, step1.paymentId, 'CANCELLED', { statusDetail: err.message });
    throw err;
  }
}

async function notifySession(tenantId, sessionId, branchId) {
  const session = await tablesRepo.findSessionById(tenantId, sessionId);
  publish({
    tenantId, branchId, topic: 'session', event: 'balance_updated',
    data: { sessionId: session?.public_id, paid: session?.paid_amount, total: session?.total_amount, status: session?.status },
  });
  publish({ tenantId, branchId, topic: 'payments', event: 'balance_updated', data: { sessionId } });
}

// Dividir en partes iguales — sólo efectivo (liquida en el momento). Para
// MercadoPago, cada persona paga su parte con `mode: INDIVIDUAL`.
async function splitEqual(tenantId, sessionId, parts, actor, cashSessionId = null) {
  const n = Number(parts);
  if (!Number.isInteger(n) || n < 2 || n > 20) throw new ValidationError('Elegí entre 2 y 20 partes.');
  const paymentIds = await withTransaction(async (conn) => {
    const session = await tablesRepo.lockSession(tenantId, sessionId, conn);
    if (!session) throw new NotFoundError('Esa mesa no existe.');
    assertPayable(session);
    const remaining = computeGroupAmountCents(session);
    if (remaining <= 0) throw new ConflictError('La mesa ya está saldada.', { code: 'ALREADY_PAID' });

    const share = Math.floor(remaining / n);
    const ids = [];
    let appliedSoFar = 0;
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      const amountCents = isLast ? remaining - appliedSoFar : share;
      appliedSoFar += amountCents;
      const { id: paymentId } = await repo.createPayment(tenantId, {
        branchId: session.branch_id, sessionId, kind: 'SESSION_SPLIT', provider: 'CASH',
        amount: fromCents(amountCents), currency: session.currency, cashSessionId, createdBy: actor.actorId ?? null,
      }, conn);
      await repo.addAllocation(tenantId, paymentId, { amount: fromCents(amountCents) }, conn);
      await settleCashPayment(tenantId, sessionId, paymentId, amountCents, conn, { cashSessionId, actorId: actor.actorId });
      ids.push(paymentId);
    }
    await enqueue(conn, { tenantId, branchId: session.branch_id, type: 'PaymentApproved', payload: { sessionId, split: n } });
    return ids;
  });
  await notifySession(tenantId, sessionId, (await tablesRepo.findSessionById(tenantId, sessionId)).branch_id);
  return Promise.all(paymentIds.map((id) => getPayment(tenantId, id)));
}

// ============================================================ cobrar un pedido de mostrador
async function chargeOrder(tenantId, orderId, input, actor) {
  const { provider } = input;
  const step1 = await withTransaction(async (conn) => {
    const order = await ordersRepo.lockOrder(tenantId, orderId, conn);
    if (!order) throw new NotFoundError('Ese pedido no existe.');
    if (order.session_id) throw new ValidationError('Ese pedido pertenece a una mesa; cobralo desde ahí.');
    if (order.payment_status === 'PAID') throw new ConflictError('Ese pedido ya está pagado.', { code: 'ALREADY_PAID' });

    const amountCents = toCents(order.total);
    if (amountCents <= 0) throw new ValidationError('El pedido no tiene ítems.');
    const { id: paymentId, externalReference } = await repo.createPayment(tenantId, {
      branchId: order.branch_id, orderId, kind: 'ORDER', provider,
      amount: order.total, tipAmount: input.tipAmount ?? 0, currency: order.currency,
      cashSessionId: provider === 'CASH' ? input.cashSessionId ?? null : null, createdBy: actor.actorId ?? null,
    }, conn);
    await repo.addAllocation(tenantId, paymentId, { orderId, amount: order.total }, conn);

    if (provider === 'CASH') {
      await repo.setPaymentStatus(tenantId, paymentId, 'APPROVED', {}, conn);
      await repo.addTransaction(tenantId, paymentId, { type: 'CAPTURE', amount: order.total, status: 'approved' }, conn);
      if (input.cashSessionId) {
        await cashService.recordCashMovementForPayment(tenantId, input.cashSessionId, {
          type: 'SALE', amount: order.total, paymentId, actorUserId: actor.actorId ?? null,
        }, conn);
      }
      await ordersRepo.setOrderPaymentStatus(tenantId, orderId, 'PAID', conn);
      // Fidelización (Fase 10) — sólo si el pedido ya tenía un cliente
      // identificado (Fase 9); sin regla activa es un no-op silencioso.
      await loyaltyService.earnForOrderPayment(tenantId, { customerId: order.customer_id, amountCents, orderId }, conn);
      return { done: true, paymentId, branchId: order.branch_id };
    }
    return { done: false, paymentId, externalReference, amountCents, branchId: order.branch_id };
  });

  if (step1.done) {
    await writeAudit({ req: actor.req, tenantId, branchId: step1.branchId, entityType: 'payment', entityId: step1.paymentId, action: 'charge_cash', after: { orderId } });
    publish({ tenantId, branchId: step1.branchId, topic: 'orders', event: 'payment_status', data: { orderId, paymentStatus: 'PAID' } });
    return getPayment(tenantId, step1.paymentId);
  }
  return finishMercadoPagoCheckout(tenantId, step1, `Pedido #${orderId}`);
}

// ============================================================ webhook (idempotente)
// Clave de idempotencia: no todos los tópicos de MercadoPago traen un id
// de notificación único y estable — se arma con `topic:data.id`, que
// identifica la MISMA operación aunque MercadoPago reintente el envío.
function mapMpStatus(mpStatus) {
  return {
    approved: 'APPROVED', pending: 'PENDING', in_process: 'PENDING',
    rejected: 'REJECTED', cancelled: 'CANCELLED', refunded: 'REFUNDED', charged_back: 'REFUNDED',
  }[mpStatus] || null;
}

// Aplica un estado YA RE-CONSULTADO a la API de MP (nunca el payload crudo
// de un webhook) sobre un pago propio. Compartido por el webhook y por el
// chequeo manual (checkPendingMpPayment) — misma lógica, dos formas de
// enterarse de que MercadoPago aprobó algo.
async function applyMpPaymentUpdate(tenantId, payment, real, conn) {
  const mapped = mapMpStatus(real.status);
  let sessionStatus = null;
  if (!mapped || mapped === payment.status || !canPaymentTransition(payment.status, mapped)) {
    return { mapped: null, sessionStatus };
  }
  await repo.setPaymentStatus(tenantId, payment.id, mapped, { statusDetail: real.statusDetail, providerRef: real.id }, conn);
  await repo.addTransaction(tenantId, payment.id, {
    type: mapped === 'APPROVED' ? 'CAPTURE' : 'AUTHORIZE', providerTxnId: real.id, amount: payment.amount, status: real.status, raw: real,
  }, conn);

  if (mapped === 'APPROVED') {
    if (payment.session_id) {
      await tablesRepo.lockSession(tenantId, payment.session_id, conn);
      const applied = await applyApprovedAmount(tenantId, payment.session_id, toCents(payment.amount), conn);
      sessionStatus = applied.sessionStatus;
      if (applied.overpayCents > 0) {
        await repo.createRefund(tenantId, payment.id, {
          amount: fromCents(applied.overpayCents), status: 'PENDING',
          reason: 'Pago duplicado o llegó cuando la mesa ya estaba saldada.',
        }, conn);
      }
    } else if (payment.order_id) {
      const order = await ordersRepo.lockOrder(tenantId, payment.order_id, conn);
      await ordersRepo.setOrderPaymentStatus(tenantId, payment.order_id, 'PAID', conn);
      await loyaltyService.earnForOrderPayment(tenantId, { customerId: order.customer_id, amountCents: toCents(payment.amount), orderId: payment.order_id }, conn);
    }
  }
  return { mapped, sessionStatus };
}

async function processMpWebhookNotification({ dataId, topic, signatureOk }) {
  const notificationId = `${topic || 'payment'}:${dataId}`;
  return withTransaction(async (conn) => {
    if (await repo.findWebhookEvent(notificationId, conn)) {
      return { duplicate: true };
    }
    let eventRowId;
    try {
      eventRowId = await repo.insertWebhookEvent(notificationId, { topic, resourceId: dataId, signatureOk }, conn);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return { duplicate: true }; // llegaron dos en simultáneo
      throw err;
    }

    if (!signatureOk) {
      await repo.markWebhookProcessed(eventRowId, conn);
      return { duplicate: false, ignored: true, reason: 'bad_signature' };
    }

    // Nunca se confía en el payload del webhook a secas: se re-consulta el
    // estado real del pago a la API de MercadoPago.
    const real = await mpProvider.fetchPaymentStatus(dataId);
    const payment =
      (await repo.findPaymentByExternalRef(real.externalReference, conn)) ||
      (await repo.findPaymentByProviderRef(dataId, conn));
    if (!payment) {
      await repo.markWebhookProcessed(eventRowId, conn);
      return { duplicate: false, unmatched: true };
    }

    const tenantId = payment.tenant_id;
    const { mapped, sessionStatus } = await applyMpPaymentUpdate(tenantId, payment, real, conn);
    await repo.markWebhookProcessed(eventRowId, conn);
    return { duplicate: false, paymentId: payment.id, tenantId, branchId: payment.branch_id, sessionId: payment.session_id, mapped, sessionStatus };
  }).then(async (result) => {
    if (!result.duplicate && !result.ignored && !result.unmatched && result.mapped === 'APPROVED') {
      publish({ tenantId: result.tenantId, branchId: result.branchId, topic: 'payments', event: 'payment_approved', data: { paymentId: result.paymentId } });
      if (result.sessionId) await notifySession(result.tenantId, result.sessionId, result.branchId);
    }
    return result;
  });
}

// Chequeo MANUAL de un pago MERCADOPAGO todavía PENDING — para cuando el
// webhook no llegó (típico en desarrollo local: MercadoPago no puede
// pegarle a un backend en localhost sin un túnel público) o tardó. Busca
// por external_reference (lo generamos nosotros, no depende de que MP nos
// haya avisado nada) y aplica el mismo camino que el webhook si encuentra
// algo. Lo dispara el staff a pedido ("Verificar pago"), no un cron.
async function checkPendingMpPayment(tenantId, paymentId, actor) {
  const outcome = await withTransaction(async (conn) => {
    const payment = await repo.lockPayment(tenantId, paymentId, conn);
    if (!payment) throw new NotFoundError('Ese pago no existe.');
    if (payment.provider !== 'MERCADOPAGO') throw new ValidationError('Este pago no es de MercadoPago.');
    if (payment.status !== 'PENDING') return { checked: false }; // ya se resolvió antes (webhook, u otro chequeo)

    const real = await mpProvider.findPaymentByExternalReference(payment.external_reference);
    if (!real) return { checked: true, found: false }; // MercadoPago todavía no tiene nada con esta referencia

    const { mapped, sessionStatus } = await applyMpPaymentUpdate(tenantId, payment, real, conn);
    return { checked: true, found: true, mapped, sessionStatus, branchId: payment.branch_id, sessionId: payment.session_id };
  });
  if (outcome.mapped === 'APPROVED') {
    publish({ tenantId, branchId: outcome.branchId, topic: 'payments', event: 'payment_approved', data: { paymentId } });
    if (outcome.sessionId) await notifySession(tenantId, outcome.sessionId, outcome.branchId);
    await writeAudit({ req: actor.req, tenantId, branchId: outcome.branchId, entityType: 'payment', entityId: paymentId, action: 'check_mp_status', after: { mapped: outcome.mapped } });
  }
  return { ...(await getPayment(tenantId, paymentId)), checked: outcome.checked, foundUpdate: !!outcome.found };
}

// ============================================================ devoluciones
async function refundPayment(tenantId, paymentId, input, actor) {
  const result = await withTransaction(async (conn) => {
    const payment = await repo.lockPayment(tenantId, paymentId, conn);
    if (!payment) throw new NotFoundError('Ese pago no existe.');
    if (!SETTLED_LIKE.has(payment.status)) throw new ConflictError('Ese pago no se puede devolver en su estado actual.');

    const alreadyRefunded = await repo.sumRefunded(tenantId, paymentId, conn);
    const refundableCents = toCents(payment.amount) - toCents(alreadyRefunded);
    const amountCents = input.amount != null ? toCents(input.amount) : refundableCents;
    if (amountCents <= 0 || amountCents > refundableCents) throw new ValidationError('El monto de la devolución no es válido.');

    if (payment.provider === 'MERCADOPAGO' && payment.provider_ref) {
      await mpProvider.refund(payment.provider_ref, fromCents(amountCents)); // tira DomainError humano si falla
    }
    if (payment.provider === 'CASH' && payment.cash_session_id) {
      // sólo se refleja en la caja si todavía está abierta — una caja
      // cerrada no se vuelve a tocar (queda como ajuste contable aparte).
      const cashSession = await cashRepo.findSession(tenantId, payment.cash_session_id, conn);
      if (cashSession && cashSession.status === 'OPEN') {
        await cashService.recordCashMovementForPayment(tenantId, payment.cash_session_id, {
          type: 'REFUND', amount: fromCents(-amountCents), paymentId, actorUserId: actor.actorId ?? null,
        }, conn);
      }
    }
    await repo.createRefund(tenantId, paymentId, { amount: fromCents(amountCents), reason: input.reason, createdBy: actor.actorId ?? null }, conn);
    await repo.addTransaction(tenantId, paymentId, { type: 'REFUND', amount: fromCents(-amountCents), status: 'refunded' }, conn);

    const fullyRefunded = toCents(alreadyRefunded) + amountCents >= toCents(payment.amount);
    const newStatus = fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    assertPaymentTransition(payment.status, newStatus);
    await repo.setPaymentStatus(tenantId, paymentId, newStatus, {}, conn);

    if (payment.session_id) {
      const session = await tablesRepo.findSessionById(tenantId, payment.session_id, conn);
      if (!['CLOSED', 'FORCE_CLOSED', 'ABANDONED'].includes(session.status)) {
        await tablesRepo.lockSession(tenantId, payment.session_id, conn);
        const fresh = await tablesRepo.findSessionById(tenantId, payment.session_id, conn);
        const newPaid = Math.max(0, toCents(fresh.paid_amount) - amountCents);
        await tablesRepo.setSessionAmounts(tenantId, payment.session_id, fromCents(newPaid), conn);
        await syncSessionStatus(tenantId, payment.session_id, conn);
      }
    } else if (payment.order_id) {
      await ordersRepo.setOrderPaymentStatus(tenantId, payment.order_id, fullyRefunded ? 'REFUNDED' : 'PARTIALLY_PAID', conn);
    }
    return { branchId: payment.branch_id, sessionId: payment.session_id };
  });
  await writeAudit({ req: actor.req, tenantId, branchId: result.branchId, entityType: 'payment', entityId: paymentId, action: 'refund', reason: input.reason, after: { amount: input.amount ?? null } });
  if (result.sessionId) await notifySession(tenantId, result.sessionId, result.branchId);
  return getPayment(tenantId, paymentId);
}

// Conciliación (prompt.txt §34) — construida a partir de NUESTRO propio
// ledger, no de un reporte externo de MercadoPago (no hay cuenta real en
// este entorno para cruzar contra ella — ver FASE7.md). Igual detecta las
// categorías de discrepancia que puede ver el propio sistema: pagos que
// quedaron PENDING sin resolver, pedidos de mostrador entregados sin
// cobrar, mesas cerradas por la fuerza con saldo, y excedentes sin devolver.
async function getReconciliation(tenantId, branchId, { staleMinutes = 30 } = {}) {
  const [staleRes, unpaidRes, forceClosedRes, refundsRes] = await Promise.all([
    pool.query(
      `SELECT id, public_id, kind, amount, currency, created_at FROM payments
        WHERE tenant_id = :tenantId AND branch_id = :branchId AND status = 'PENDING'
          AND created_at < DATE_SUB(NOW(), INTERVAL :staleMinutes MINUTE)
        ORDER BY created_at`,
      { tenantId, branchId, staleMinutes }
    ),
    pool.query(
      `SELECT id, public_id, total, currency, channel, status, delivered_at FROM orders
        WHERE tenant_id = :tenantId AND branch_id = :branchId AND session_id IS NULL
          AND payment_status = 'UNPAID' AND status IN ('DELIVERED','COMPLETED')
        ORDER BY delivered_at DESC LIMIT 100`,
      { tenantId, branchId }
    ),
    pool.query(
      `SELECT id, public_id, total_amount, paid_amount, currency, closed_at FROM table_sessions
        WHERE tenant_id = :tenantId AND branch_id = :branchId AND status = 'FORCE_CLOSED'
          AND paid_amount < total_amount
        ORDER BY closed_at DESC LIMIT 100`,
      { tenantId, branchId }
    ),
    pool.query(
      `SELECT r.id, r.payment_id, r.amount, r.reason, r.created_at, p.public_id AS payment_public_id
         FROM refunds r JOIN payments p ON p.id = r.payment_id
        WHERE p.tenant_id = :tenantId AND p.branch_id = :branchId AND r.status = 'PENDING'
        ORDER BY r.created_at DESC LIMIT 100`,
      { tenantId, branchId }
    ),
  ]);
  return {
    stalePending: staleRes[0],
    unpaidCounterOrders: unpaidRes[0],
    forceClosedWithBalance: forceClosedRes[0],
    pendingRefunds: refundsRes[0],
  };
}

module.exports = {
  getSessionBalance, chargeSession, splitEqual, chargeOrder,
  processMpWebhookNotification, checkPendingMpPayment, refundPayment,
  getPayment, listPayments, getReconciliation,
  // exportado para tests
  _mapMpStatus: mapMpStatus,
};
