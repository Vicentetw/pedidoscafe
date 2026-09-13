const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, assertTransition, TERMINAL, ACTIVE } = require('../src/modules/tables/tableSession.stateMachine');
const { DomainError } = require('../src/errors');

test('transiciones válidas del ciclo normal', () => {
  assert.ok(canTransition('OPEN', 'ORDERING'));
  assert.ok(canTransition('ORDERING', 'SERVING'));
  assert.ok(canTransition('SERVING', 'BILL_REQUESTED'));
  assert.ok(canTransition('BILL_REQUESTED', 'PARTIALLY_PAID'));
  assert.ok(canTransition('PARTIALLY_PAID', 'PAID'));
  assert.ok(canTransition('PAID', 'CLOSED'));
});

test('cierres alternativos', () => {
  assert.ok(canTransition('OPEN', 'ABANDONED'));
  assert.ok(canTransition('OPEN', 'FORCE_CLOSED'));
  assert.ok(canTransition('SERVING', 'FORCE_CLOSED'));
  assert.ok(canTransition('ABANDONED', 'BILL_REQUESTED')); // se reabre por un pago
});

test('transiciones prohibidas', () => {
  assert.ok(!canTransition('CLOSED', 'OPEN'));
  assert.ok(!canTransition('FORCE_CLOSED', 'OPEN'));
  assert.ok(!canTransition('PAID', 'ORDERING'));
});

// SERVING/ORDERING/BILL_REQUESTED/PARTIALLY_PAID -> CLOSED: agregado por
// un bug real (aceptación) — sacar el único ítem de un pedido confirmado
// deja total_amount=0 y paid_amount=0 sin que nada empuje el status de
// vuelta a PAID/OPEN (syncSessionStatus no tiene a dónde sincronizar un
// "0 y 0"). La mesa quedaba con la plata saldada de verdad pero sin
// ningún camino a CLOSED. closeSession() ya exige paid===total ANTES de
// intentar esta transición, así que permitirla acá no afloja esa regla.
test('CLOSED ahora es alcanzable desde cualquier status operativo (closeSession ya valida el saldo antes)', () => {
  assert.ok(canTransition('ORDERING', 'CLOSED'));
  assert.ok(canTransition('SERVING', 'CLOSED'));
  assert.ok(canTransition('BILL_REQUESTED', 'CLOSED'));
  assert.ok(canTransition('PARTIALLY_PAID', 'CLOSED'));
});

test('assertTransition permite from===to y tira DomainError 409 en una inválida', () => {
  assert.doesNotThrow(() => assertTransition('OPEN', 'OPEN'));
  assert.doesNotThrow(() => assertTransition('OPEN', 'ORDERING'));
  try {
    assertTransition('CLOSED', 'OPEN');
    assert.fail('debió tirar');
  } catch (e) {
    assert.ok(e instanceof DomainError);
    assert.equal(e.status, 409);
    assert.equal(e.code, 'INVALID_SESSION_TRANSITION');
  }
});

test('conjuntos TERMINAL / ACTIVE', () => {
  assert.ok(TERMINAL.has('CLOSED') && TERMINAL.has('ABANDONED') && TERMINAL.has('FORCE_CLOSED'));
  assert.ok(ACTIVE.has('OPEN') && ACTIVE.has('PAID'));
  assert.ok(!ACTIVE.has('CLOSED'));
});
