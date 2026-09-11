// Errores de dominio. Los services tiran ESTOS; errorHandler los traduce a
// HTTP + mensaje en lenguaje humano. Nunca se filtra un stack ni un
// "409 Conflict" crudo al cliente (prompt.txt §59).
class DomainError extends Error {
  /**
   * @param {string} message  mensaje apto para mostrarle a una persona
   * @param {object} [opts]
   * @param {number} [opts.status=400]
   * @param {string} [opts.code]     código estable para el front (ej. 'ITEM_UNAVAILABLE')
   * @param {object} [opts.details]  datos extra seguros de exponer
   */
  constructor(message, { status = 400, code = 'DOMAIN_ERROR', details = undefined } = {}) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

class ValidationError extends DomainError {
  constructor(message = 'Los datos enviados no son válidos.', details) {
    super(message, { status: 422, code: 'VALIDATION', details });
    this.name = 'ValidationError';
  }
}

class NotFoundError extends DomainError {
  constructor(message = 'No se encontró lo que buscás.') {
    super(message, { status: 404, code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}

class ForbiddenError extends DomainError {
  constructor(message = 'No tenés permiso para hacer esto.', details) {
    super(message, { status: 403, code: 'FORBIDDEN', details });
    this.name = 'ForbiddenError';
  }
}

class UnauthorizedError extends DomainError {
  constructor(message = 'Necesitás iniciar sesión.') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
    this.name = 'UnauthorizedError';
  }
}

class ConflictError extends DomainError {
  constructor(message = 'Ese registro ya existe.', { code = 'CONFLICT', details } = {}) {
    super(message, { status: 409, code, details });
    this.name = 'ConflictError';
  }
}

module.exports = {
  DomainError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  ConflictError,
};
