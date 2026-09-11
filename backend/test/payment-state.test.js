const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, assertTransition, TERMINAL, SETTLED_LIKE } = require('../src/modules/payments/payment.stateMachine');
const { DomainError } = require('../src/errors');

test('ciclo online normal', () => {
  assert.ok(canTransition('CREATED', 'PENDING'));
  assert.ok(canTransition('PENDING', 'APPROVED'));
  assert.ok(canTransition('APPROVED', 'SETTLED'));
});

test('efectivo liquida directo CREATED -> APPROVED', () => {
  assert.ok(canTransition('CREATED', 'APPROVED'));
});

test('alternativas', () => {
  assert.ok(canTransition('PENDING', 'REJECTED'));
  assert.ok(canTransition('PENDING', 'EXPIRED'));
  assert.ok(canTransition('CREATED', 'CANCELLED'));
  assert.ok(canTransition('APPROVED', 'REFUNDED'));
  assert.ok(canTransition('APPROVED', 'PARTIALLY_REFUNDED'));
  assert.ok(canTransition('PARTIALLY_REFUNDED', 'REFUNDED'));
});

test('prohibidas', () => {
  assert.ok(!canTransition('REJECTED', 'APPROVED'));
  assert.ok(!canTransition('REFUNDED', 'APPROVED'));
  assert.ok(!canTransition('CREATED', 'SETTLED'));
});

test('assertTransition', () => {
  assert.doesNotThrow(() => assertTransition('APPROVED', 'APPROVED'));
  try { assertTransition('REJECTED', 'APPROVED'); assert.fail('debió tirar'); }
  catch (e) { assert.ok(e instanceof DomainError); assert.equal(e.code, 'INVALID_PAYMENT_TRANSITION'); }
});

test('conjuntos', () => {
  assert.ok(TERMINAL.has('REJECTED') && TERMINAL.has('REFUNDED') && TERMINAL.has('CANCELLED'));
  assert.ok(SETTLED_LIKE.has('APPROVED') && SETTLED_LIKE.has('SETTLED') && !SETTLED_LIKE.has('PENDING'));
});
