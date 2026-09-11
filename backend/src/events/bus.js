const { EventEmitter } = require('events');
const { logger } = require('../logger');

// Bus de eventos de dominio in-process. Para reacción inmediata dentro del
// mismo proceso (ej. notifications escuchando OrderConfirmed). Lo que debe
// sobrevivir un reinicio o alimentar integraciones/analytics va ADEMÁS al
// outbox (tabla domain_events) — ver outbox.js. Nombres estables de eventos
// en ARQUITECTURA_V1 §2.

class DomainBus extends EventEmitter {
  emitEvent(type, payload) {
    logger.debug('domain_event', { type });
    this.emit(type, payload);
    this.emit('*', { type, payload });
  }
}

// Singleton para todo el proceso.
const bus = new DomainBus();
bus.setMaxListeners(50);

module.exports = { bus };
