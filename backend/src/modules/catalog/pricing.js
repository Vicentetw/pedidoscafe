// Cálculo de precio del catálogo. El backend es la ÚNICA fuente de verdad
// del precio (ARQUITECTURA_V1 §15): esta función toma SÓLO ids + cantidades
// y resuelve el importe desde las tablas. Nunca mira un precio que venga
// del cliente.
//
// Se trabaja en centavos enteros para no arrastrar error de punto flotante.
// mysql2 devuelve las columnas DECIMAL como string ("4500.00"): toCents()
// las normaliza.

function toCents(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  const s = String(value).trim();
  const neg = s.startsWith('-');
  const [intPart, fracPart = ''] = s.replace('-', '').split('.');
  const cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  return neg ? -cents : cents;
}

function fromCents(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Precio unitario de un producto (sin cantidad, sin modificadores).
 * @param {{ base_price: string|number }} product
 * @param {{ branchOverridePrice?: string|number|null, variant?: { price_delta: string|number }|null }} [ctx]
 * @returns {number} centavos
 */
function unitPriceCents(product, { branchOverridePrice = null, variant = null } = {}) {
  const base = branchOverridePrice != null ? toCents(branchOverridePrice) : toCents(product.base_price);
  const variantDelta = variant ? toCents(variant.price_delta) : 0;
  return base + variantDelta;
}

/**
 * Total de una línea de pedido resuelto desde el catálogo.
 * @param {object} args
 * @param {{ base_price: string|number, currency?: string }} args.product
 * @param {string|number|null} [args.branchOverridePrice]
 * @param {{ price_delta: string|number }|null} [args.variant]
 * @param {{ price_delta: string|number }[]} [args.modifiers]
 * @param {number} args.qty
 * @returns {{ unitPrice: string, modifiersTotal: string, lineTotal: string,
 *            unitPriceCents: number, modifiersTotalCents: number, lineTotalCents: number,
 *            currency: string }}
 */
function priceLine({ product, branchOverridePrice = null, variant = null, modifiers = [], qty }) {
  const q = Math.max(1, Math.trunc(Number(qty) || 0));
  const unit = unitPriceCents(product, { branchOverridePrice, variant });
  const modsTotal = modifiers.reduce((acc, m) => acc + toCents(m.price_delta), 0);
  const line = (unit + modsTotal) * q;
  return {
    currency: product.currency || 'ARS',
    unitPriceCents: unit,
    modifiersTotalCents: modsTotal,
    lineTotalCents: line,
    unitPrice: fromCents(unit),
    modifiersTotal: fromCents(modsTotal),
    lineTotal: fromCents(line),
  };
}

module.exports = { toCents, fromCents, unitPriceCents, priceLine };
