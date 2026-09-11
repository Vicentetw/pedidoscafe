const repo = require('./promotions.repository');
const ordersRepo = require('../orders/orders.repository');
const branchRepo = require('../platform/branches.repository');
const loyaltyRepo = require('../loyalty/loyalty.repository');
const { toCents, fromCents } = require('../catalog/pricing');
const { withTransaction } = require('../../withTransaction');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');

// Tipos con motor de cálculo real en esta fase. BOGO/COMBO/FREE_ITEM/
// HAPPY_HOUR quedan en el enum de la base (mismo que ARQUITECTURA_V1) pero
// no tienen forma de aplicarse todavía: elegir QUÉ ítem puntual se regala o
// combea es una decisión de producto que no está tomada (¿lo elige el
// staff? ¿el más barato de los elegibles?) — inventar un criterio acá sería
// adivinar. Ver FASE11.md.
const COMPUTABLE_TYPES = ['PERCENT', 'FIXED'];

// ============================================================ CRUD
async function createPromotion(tenantId, input, req) {
  if (!COMPUTABLE_TYPES.includes(input.type)) {
    throw new ValidationError(`Las promociones de tipo ${input.type} todavía no se pueden crear: no tienen motor de cálculo en esta versión. Usá PERCENT o FIXED.`);
  }
  if (input.value == null) throw new ValidationError('Falta el valor de la promoción.');
  if (input.type === 'PERCENT' && (input.value <= 0 || input.value > 100)) throw new ValidationError('Un porcentaje tiene que ser mayor a 0 y hasta 100.');
  const id = await repo.createPromotion(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'promotion', entityId: id, action: 'create', after: input });
  return getPromotion(tenantId, id);
}
async function listPromotions(tenantId, query) { return repo.listPromotions(tenantId, query); }
async function getPromotion(tenantId, id) {
  const promo = await repo.findPromotion(tenantId, id);
  if (!promo) throw new NotFoundError('Esa promoción no existe.');
  const rules = await repo.listRulesForPromotion(tenantId, id);
  return { ...promo, rules };
}
async function addRule(tenantId, promotionId, input, req) {
  await getPromotion(tenantId, promotionId); // 404 si no existe / no es de este tenant
  validateRuleShape(input.conditionType, input.value);
  const id = await repo.createRule(tenantId, promotionId, input);
  await writeAudit({ req, tenantId, entityType: 'promotion_rule', entityId: id, action: 'create', after: { promotionId, ...input } });
  return getPromotion(tenantId, promotionId);
}
async function setStatus(tenantId, id, status, req) {
  await getPromotion(tenantId, id);
  await repo.setStatus(tenantId, id, status);
  await writeAudit({ req, tenantId, entityType: 'promotion', entityId: id, action: 'set_status', after: { status } });
  return getPromotion(tenantId, id);
}

function validateRuleShape(conditionType, value) {
  const need = (cond, ok, msg) => { if (!ok) throw new ValidationError(msg); };
  switch (conditionType) {
    case 'BRANCH': return need('BRANCH', value.branchId != null || Array.isArray(value.branchIds), 'BRANCH necesita "branchId" o "branchIds".');
    case 'CATEGORY': return need('CATEGORY', value.categoryId != null || Array.isArray(value.categoryIds), 'CATEGORY necesita "categoryId" o "categoryIds".');
    case 'PRODUCT': return need('PRODUCT', value.productId != null || Array.isArray(value.productIds), 'PRODUCT necesita "productId" o "productIds".');
    case 'MIN_QTY': return need('MIN_QTY', Number(value.qty) > 0, 'MIN_QTY necesita "qty" mayor a 0.');
    case 'MIN_AMOUNT': return need('MIN_AMOUNT', Number(value.amount) > 0, 'MIN_AMOUNT necesita "amount" mayor a 0.');
    case 'CUSTOMER_TIER': return need('CUSTOMER_TIER', value.tierCode != null || Array.isArray(value.tierCodes), 'CUSTOMER_TIER necesita "tierCode" o "tierCodes".');
    case 'DAY': return need('DAY', Array.isArray(value.days) && value.days.length, 'DAY necesita "days" (0=lunes..6=domingo).');
    case 'TIME': return need('TIME', typeof value.from === 'string' && typeof value.to === 'string', 'TIME necesita "from" y "to" (HH:MM).');
  }
}

// hora/día en el huso de la sucursal — mismo criterio que
// catalog.service.categoryActiveNow (Fase 2).
function nowInBranch(tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const days = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { hhmm: `${parts.hour}:${parts.minute}`, weekday: days[parts.weekday] ?? 0 };
}

// Devuelve null si la condición se cumple, o un mensaje humano si no.
async function evaluateRule(tenantId, rule, ctx, conn) {
  const v = rule.value;
  switch (rule.condition_type) {
    case 'BRANCH': {
      const ids = v.branchIds || [v.branchId];
      return ids.includes(ctx.order.branch_id) ? null : 'Esta promoción no aplica en esta sucursal.';
    }
    case 'MIN_AMOUNT':
      return ctx.subtotalCents >= toCents(v.amount) ? null : `Falta llegar a un mínimo de $${v.amount} para esta promoción.`;
    case 'MIN_QTY': {
      const totalQty = ctx.items.reduce((s, it) => s + Number(it.qty), 0);
      return totalQty >= Number(v.qty) ? null : `Esta promoción necesita al menos ${v.qty} unidades en el pedido.`;
    }
    case 'PRODUCT': {
      const ids = v.productIds || [v.productId];
      return ctx.items.some((it) => ids.includes(it.product_id)) ? null : 'El pedido no tiene ninguno de los productos requeridos por esta promoción.';
    }
    case 'CATEGORY': {
      const ids = v.categoryIds || [v.categoryId];
      const productIds = [...new Set(ctx.items.map((it) => it.product_id))];
      const cats = await repo.categoriesForProducts(tenantId, productIds, conn);
      return cats.some((c) => ids.includes(c)) ? null : 'El pedido no tiene productos de la categoría que pide esta promoción.';
    }
    case 'DAY':
      return (v.days || []).includes(ctx.now.weekday) ? null : 'Esta promoción no aplica hoy.';
    case 'TIME':
      return ctx.now.hhmm >= v.from && ctx.now.hhmm < v.to ? null : `Esta promoción sólo aplica de ${v.from} a ${v.to}.`;
    case 'CUSTOMER_TIER': {
      if (!ctx.order.customer_id) return 'Esta promoción requiere un cliente identificado en el pedido.';
      const allowed = v.tierCodes || [v.tierCode];
      const account = await loyaltyRepo.findAccountByCustomer(tenantId, ctx.order.customer_id, conn);
      const tier = account ? await loyaltyRepo.resolveTier(tenantId, account.points_balance, conn) : null;
      return tier && allowed.includes(tier.code) ? null : 'El cliente no tiene el nivel de fidelización que pide esta promoción.';
    }
    default:
      return null;
  }
}

// ============================================================ aplicar
async function applyPromotion(tenantId, orderId, code, actor) {
  const result = await withTransaction(async (conn) => {
    const order = await ordersRepo.lockOrder(tenantId, orderId, conn);
    if (!order) throw new NotFoundError('Ese pedido no existe.');
    if (order.payment_status !== 'UNPAID') throw new ConflictError('Este pedido ya tiene un pago registrado; no se pueden tocar sus descuentos.');
    if (['CANCELLED', 'COMPLETED'].includes(order.status)) throw new ConflictError('Este pedido ya está cerrado.');

    const promo = await repo.findActiveByCode(tenantId, code, conn);
    if (!promo) throw new NotFoundError('No existe una promoción activa con ese código.');
    if (!COMPUTABLE_TYPES.includes(promo.type)) throw new ValidationError('Este tipo de promoción todavía no se puede aplicar automáticamente.');
    const now = new Date();
    if (promo.active_from && now < new Date(promo.active_from)) throw new ConflictError('Esta promoción todavía no empezó.');
    if (promo.active_to && now > new Date(promo.active_to)) throw new ConflictError('Esta promoción ya terminó.');

    const items = await ordersRepo.listItems(tenantId, orderId, conn);
    if (!items.length) throw new ValidationError('El pedido no tiene ítems.');
    const subtotalCents = items.reduce((s, it) => s + toCents(it.line_total), 0);

    const existing = await repo.listRedemptionsForOrder(tenantId, orderId, conn);
    if (existing.some((r) => r.promotion_id === promo.id)) {
      return { alreadyApplied: true, branchId: order.branch_id };
    }
    if (existing.length > 0) {
      if (!promo.stackable) throw new ConflictError('Esta promoción no se combina con otras; sacá las demás primero.', { code: 'PROMOTION_NOT_STACKABLE' });
      if (existing.some((r) => !r.stackable_snapshot)) throw new ConflictError('Ya hay una promoción no combinable aplicada; sacala primero.', { code: 'PROMOTION_NOT_STACKABLE' });
    }

    const branch = await branchRepo.findById(tenantId, order.branch_id, conn);
    const rules = await repo.listRulesForPromotion(tenantId, promo.id, conn);
    const ctx = { order, items, subtotalCents, now: nowInBranch(branch?.timezone) };
    for (const rule of rules) {
      const fail = await evaluateRule(tenantId, rule, ctx, conn);
      if (fail) throw new ConflictError(fail, { code: 'PROMOTION_NOT_ELIGIBLE' });
    }

    await repo.createRedemption(tenantId, {
      promotionId: promo.id, orderId, amount: '0.00', code: promo.code, type: promo.type,
      value: promo.value, priority: promo.priority, stackable: promo.stackable,
    }, conn);

    await recomputeDiscountForOrder(tenantId, orderId, items, conn);
    return { alreadyApplied: false, branchId: order.branch_id };
  });
  if (!result.alreadyApplied) {
    await writeAudit({ req: actor.req, tenantId, branchId: result.branchId, entityType: 'order', entityId: orderId, action: 'apply_promotion', after: { code } });
  }
  const { getOrder } = require('../orders/orders.service');
  return getOrder(tenantId, orderId);
}

async function removePromotion(tenantId, orderId, code, actor) {
  const result = await withTransaction(async (conn) => {
    const order = await ordersRepo.lockOrder(tenantId, orderId, conn);
    if (!order) throw new NotFoundError('Ese pedido no existe.');
    if (order.payment_status !== 'UNPAID') throw new ConflictError('Este pedido ya tiene un pago registrado; no se pueden tocar sus descuentos.');

    const existing = await repo.listRedemptionsForOrder(tenantId, orderId, conn);
    const target = existing.find((r) => r.code_snapshot === code);
    if (!target) throw new NotFoundError('Esa promoción no está aplicada a este pedido.');
    await repo.deleteRedemption(tenantId, orderId, target.promotion_id, conn);

    const items = await ordersRepo.listItems(tenantId, orderId, conn);
    await recomputeDiscountForOrder(tenantId, orderId, items, conn, { force: true });
    return { branchId: order.branch_id };
  });
  await writeAudit({ req: actor.req, tenantId, branchId: result.branchId, entityType: 'order', entityId: orderId, action: 'remove_promotion', after: { code } });
  const { getOrder } = require('../orders/orders.service');
  return getOrder(tenantId, orderId);
}

// Recalcula el descuento total del pedido a partir de sus canjes YA
// aplicados (snapshot, no vuelve a leer `promotions`) contra el subtotal
// ACTUAL de items — así sobrevive a que se agreguen/saquen ítems después de
// aplicar la promo. Se aplica en orden de prioridad; nunca deja el total
// por debajo de $0. Llamado desde orders.service en cada cambio de ítems
// (no-op barato si el pedido no tiene ninguna promoción aplicada).
async function recomputeDiscountForOrder(tenantId, orderId, items, conn, { force = false } = {}) {
  const redemptions = await repo.listRedemptionsForOrder(tenantId, orderId, conn);
  const subtotalCents = items.reduce((s, it) => s + toCents(it.line_total), 0);
  // Atajo barato para el caso común (un pedido que nunca tuvo promociones):
  // orders.service ya escribió subtotal/discount=0/total antes de llamar
  // acá. `force` lo pisa — lo necesita removePromotion cuando el canje que
  // se acaba de borrar era el ÚLTIMO: sin esto, el discount_total viejo
  // quedaría pisado para siempre (nadie más lo vuelve a escribir).
  if (!redemptions.length && !force) return { discountCents: 0, subtotalCents };

  let remaining = subtotalCents;
  let totalDiscountCents = 0;
  for (const r of redemptions) { // ya vienen ORDER BY priority_snapshot
    let amt = r.type_snapshot === 'PERCENT' ? Math.round(subtotalCents * Number(r.value_snapshot) / 100) : toCents(r.value_snapshot);
    amt = Math.max(0, Math.min(amt, remaining));
    remaining -= amt;
    totalDiscountCents += amt;
    await repo.updateRedemptionAmount(tenantId, r.id, fromCents(amt), conn);
  }
  await ordersRepo.setOrderTotals(tenantId, orderId, {
    subtotal: fromCents(subtotalCents), discount: fromCents(totalDiscountCents), tax: '0.00', tip: '0.00',
    total: fromCents(subtotalCents - totalDiscountCents),
  }, conn);
  return { discountCents: totalDiscountCents, subtotalCents };
}

module.exports = {
  createPromotion, listPromotions, getPromotion, addRule, setStatus,
  applyPromotion, removePromotion, recomputeDiscountForOrder,
};
