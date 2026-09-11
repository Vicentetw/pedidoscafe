const { DomainError } = require('../../errors');

// Máquina de estados de TableSession (ARQUITECTURA_V1 §7). Las transiciones
// ORDERING/SERVING/BILL_REQUESTED/PARTIALLY_PAID/PAID las dispararán los
// eventos de pedidos y pagos (Fases 4 y 6); en la Fase 3 se ejercitan
// sobre todo OPEN -> {CLOSED, ABANDONED, FORCE_CLOSED} y el ida y vuelta
// OPEN <-> ORDERING <-> SERVING.

const TRANSITIONS = {
  OPEN: ['ORDERING', 'BILL_REQUESTED', 'ABANDONED', 'FORCE_CLOSED', 'CLOSED'],
  ORDERING: ['SERVING', 'BILL_REQUESTED', 'OPEN', 'ABANDONED', 'FORCE_CLOSED'],
  SERVING: ['ORDERING', 'BILL_REQUESTED', 'FORCE_CLOSED'],
  BILL_REQUESTED: ['PARTIALLY_PAID', 'PAID', 'SERVING', 'FORCE_CLOSED'],
  PARTIALLY_PAID: ['PARTIALLY_PAID', 'PAID', 'FORCE_CLOSED'],
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
