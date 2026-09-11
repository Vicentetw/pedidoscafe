const { DomainError } = require('../../errors');

// Máquina de estados de Order (ARQUITECTURA_V1 §5). Eje OPERATIVO — el eje
// de pago (payment_status) es independiente y no se toca acá.
//
// Fase 4: VALIDATING_STOCK es un paso de paso-a-través (no hay stock real
// todavía). En la Fase 5 se le enchufa la reserva pesimista y de ahí puede
// salir REJECTED_STOCK.

const TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['VALIDATING_STOCK', 'CANCELLED'],
  VALIDATING_STOCK: ['CONFIRMED', 'REJECTED_STOCK', 'CANCELLED'],
  REJECTED_STOCK: ['DRAFT', 'CANCELLED'],
  CONFIRMED: ['QUEUED', 'CANCEL_REQUESTED'],
  QUEUED: ['PREPARING', 'CANCEL_REQUESTED'],
  PREPARING: ['READY', 'CANCEL_REQUESTED'],
  READY: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCEL_REQUESTED: ['CANCELLED', 'PREPARING'], // rechazada -> vuelve a preparación
  CANCELLED: [],
};

const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);
// Estados desde los que el comensal puede cancelar por su cuenta (antes de
// que la cocina empiece). Después necesita al staff (orders:cancel_after_prep).
const GUEST_CANCELLABLE = new Set(['DRAFT', 'SUBMITTED', 'VALIDATING_STOCK', 'CONFIRMED', 'QUEUED']);
// Estados en los que el pedido ya está "en la operación" (cuenta para el
// total de la mesa, aparece en el KDS).
const IN_OPERATION = new Set(['CONFIRMED', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'COMPLETED']);

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

function assertTransition(from, to) {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new DomainError(`El pedido no puede pasar de "${from}" a "${to}".`, {
      status: 409,
      code: 'INVALID_ORDER_TRANSITION',
      details: { from, to },
    });
  }
}

module.exports = { TRANSITIONS, TERMINAL, GUEST_CANCELLABLE, IN_OPERATION, canTransition, assertTransition };
