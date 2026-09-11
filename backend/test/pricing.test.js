// Unit — cálculo de precio del catálogo. No toca base ni red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priceLine, toCents, fromCents } = require('../src/modules/catalog/pricing');

test('toCents / fromCents redondean bien y no arrastran flotante', () => {
  assert.equal(toCents('4500.00'), 450000);
  assert.equal(toCents('0.1'), 10);
  assert.equal(toCents('-12.34'), -1234);
  assert.equal(fromCents(450000), '4500.00');
  assert.equal(fromCents(5), '0.05');
});

test('precio base sin variante ni modificadores', () => {
  const r = priceLine({ product: { base_price: '4500.00', currency: 'ARS' }, qty: 1 });
  assert.equal(r.unitPrice, '4500.00');
  assert.equal(r.lineTotal, '4500.00');
  assert.equal(r.currency, 'ARS');
});

test('override de sucursal pisa el precio base', () => {
  const r = priceLine({ product: { base_price: '4500.00' }, branchOverridePrice: '4900.00', qty: 2 });
  assert.equal(r.unitPrice, '4900.00');
  assert.equal(r.lineTotal, '9800.00');
});

test('variante + modificadores + cantidad', () => {
  const r = priceLine({
    product: { base_price: '4500.00' },
    variant: { price_delta: '800.00' },
    modifiers: [{ price_delta: '300.00' }, { price_delta: '150.00' }],
    qty: 3,
  });
  // (4500 + 800 + 450) * 3
  assert.equal(r.unitPrice, '5300.00');
  assert.equal(r.modifiersTotal, '450.00');
  assert.equal(r.lineTotal, '17250.00');
});

test('modificador con delta negativo (descuento por sacar algo)', () => {
  const r = priceLine({ product: { base_price: '4500.00' }, modifiers: [{ price_delta: '-200.00' }], qty: 1 });
  assert.equal(r.lineTotal, '4300.00');
});

test('la función NO acepta un precio del cliente — sólo datos del catálogo', () => {
  // priceLine ignora cualquier propiedad extra; el importe sale siempre de
  // base_price + deltas. (mandatory case #4, a nivel función)
  const r = priceLine({
    product: { base_price: '4500.00' },
    qty: 1,
    // ruido que un cliente podría intentar inyectar:
    unitPrice: '1.00',
    price: 1,
    lineTotal: '1.00',
  });
  assert.equal(r.lineTotal, '4500.00');
});
