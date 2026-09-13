const { DomainError } = require('../../errors');

// Máquina de estados de TableSession (ARQUITECTURA_V1 §7). Las transiciones
// ORDERING/SERVING/BILL_REQUESTED/PARTIALLY_PAID/PAID las dispararán los
// eventos de pedidos y pagos (Fases 4 y 6); en la Fase 3 se ejercitan
// sobre todo OPEN -> {CLOSED, ABANDONED, FORCE_CLOSED} y el ida y vuelta
// OPEN <-> ORDERING <-> SERVING.

const TRANSITIONS = {
  OPEN: ['ORDERING', 'BILL_REQUESTED', 'ABANDONED', 'FORCE_CLOSED', 'CLOSED'],
  // ORDERING/SERVING/BILL_REQUESTED/PARTIALLY_PAID -> CLOSED: bug real
  // encontrado en la aceptación — si un pedido se cancela o se devuelve
  // DESPUÉS de que la mesa ya había avanzado de estado, total_amount y
  // paid_amount pueden volver a quedar iguales (a veces en 0 y 0) sin que
  // el status vuelva solo a OPEN/PAID (nada lo empuja para atrás). La
  // mesa quedaba con saldo saldado de verdad pero sin ningún camino
  // válido a CLOSED — "no se puede cerrar la mesa" aunque estuviera en
  // $0. closeSession() YA exige paid_amount === total_amount ANTES de
  // intentar esta transición, así que agregarla acá no afloja esa regla:
  // sólo repara los casos donde la plata está saldada pero la etiqueta
  // de estado quedó atrás.
  ORDERING: ['SERVING', 'BILL_REQUESTED', 'OPEN', 'ABANDONED', 'FORCE_CLOSED', 'CLOSED'],
  SERVING: ['ORDERING', 'BILL_REQUESTED', 'FORCE_CLOSED', 'CLOSED'],
  BILL_REQUESTED: ['PARTIALLY_PAID', 'PAID', 'SERVING', 'FORCE_CLOSED', 'CLOSED'],
  PARTIALLY_PAID: ['PARTIALLY_PAID', 'PAID', 'FORCE_CLOSED', 'CLOSED'],
  // PAID -> PARTIALLY_PAID: caso borde de una devolución parcial procesada
  // ANTES de cerrar la mesa (Fase 6). No es el camino normal.
  PAID: ['CLOSED', 'PARTIALLY_PAID'],
  CLOSED: [],
  ABANDONED: ['BILL_REQUESTED'], // se reabre si aparece un pago pendiente
  FORCE_CLOSED: [],
};

const TERMINAL = new Set(['CLOSED', 'ABANDONED', 'FORCE_CLOSED']);
const ACTIVE = new Set(['OPEN', 'ORDERING', 'SERVING', 'BILL_REQUESTED', 'PARTIALLY_PAID', 'PAID']);

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

function assertTransition(from, to) {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new DomainError(`No se puede pasar la mesa de "${from}" a "${to}".`, {
      status: 409,
      code: 'INVALID_SESSION_TRANSITION',
      details: { from, to },
    });
  }
}

module.exports = { TRANSITIONS, TERMINAL, ACTIVE, canTransition, assertTransition };
