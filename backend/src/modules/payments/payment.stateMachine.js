const { DomainError } = require('../../errors');

// Máquina de estados de Payment (ARQUITECTURA_V1 §6). CREATED->APPROVED
// directo existe para el efectivo (liquida en el momento, sin webhook).
// PENDING->APPROVED sólo lo dispara el webhook verificado + re-consulta a
// MP — nunca el retorno del navegador.

const TRANSITIONS = {
  CREATED: ['PENDING', 'APPROVED', 'CANCELLED'],
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: ['SETTLED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  SETTLED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  REFUNDED: [],
};

const TERMINAL = new Set(['REJECTED', 'EXPIRED', 'CANCELLED', 'REFUNDED']);
const SETTLED_LIKE = new Set(['APPROVED', 'SETTLED', 'PARTIALLY_REFUNDED']); // cuenta como "cobrado" para el saldo

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}
function assertTransition(from, to) {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new DomainError(`El pago no puede pasar de "${from}" a "${to}".`, {
      status: 409, code: 'INVALID_PAYMENT_TRANSITION', details: { from, to },
    });
  }
}

module.exports = { TRANSITIONS, TERMINAL, SETTLED_LIKE, canTransition, assertTransition };
