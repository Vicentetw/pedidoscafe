const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, assertTransition, TERMINAL, GUEST_CANCELLABLE, IN_OPERATION } = require('../src/modules/orders/order.stateMachine');
const { DomainError } = require('../src/errors');

test('ciclo normal', () => {
  const seq = ['DRAFT', 'SUBMITTED', 'VALIDATING_STOCK', 'CONFIRMED', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'COMPLETED'];
  for (let i = 0; i < seq.length - 1; i++) assert.ok(canTransition(seq[i], seq[i + 1]), `${seq[i]} -> ${seq[i + 1]}`);
});

test('stock rechazado y reintento', () => {
  assert.ok(canTransition('VALIDATING_STOCK', 'REJECTED_STOCK'));
  assert.ok(canTransition('REJECTED_STOCK', 'DRAFT'));
});

test('cancelación', () => {
  assert.ok(canTransition('DRAFT', 'CANCELLED'));
  assert.ok(canTransition('CONFIRMED', 'CANCEL_REQUESTED'));
  assert.ok(canTransition('PREPARING', 'CANCEL_REQUESTED'));
  assert.ok(canTransition('CANCEL_REQUESTED', 'CANCELLED'));
  assert.ok(canTransition('CANCEL_REQUESTED', 'PREPARING')); // rechazada
});

test('prohibidas', () => {
  assert.ok(!canTransition('QUEUED', 'READY'));   // hay que pasar por PREPARING
  assert.ok(!canTransition('READY', 'CANCELLED'));
  assert.ok(!canTransition('READY', 'CANCEL_REQUESTED'));
  assert.ok(!canTransition('COMPLETED', 'DELIVERED'));
});

test('assertTransition', () => {
  assert.doesNotThrow(() => assertTransition('READY', 'READY'));
  try { assertTransition('QUEUED', 'READY'); assert.fail('debió tirar'); }
  catch (e) { assert.ok(e instanceof DomainError); assert.equal(e.code, 'INVALID_ORDER_TRANSITION'); }
});

test('conjuntos', () => {
  assert.ok(TERMINAL.has('COMPLETED') && TERMINAL.has('CANCELLED'));
  assert.ok(GUEST_CANCELLABLE.has('QUEUED') && !GUEST_CANCELLABLE.has('PREPARING'));
  assert.ok(IN_OPERATION.has('CONFIRMED') && !IN_OPERATION.has('DRAFT'));
});
