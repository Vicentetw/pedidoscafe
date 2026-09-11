const { ZodError } = require('zod');
const { DomainError } = require('../errors');
const { logger } = require('../logger');

// Traduce cualquier error que llegue al final de la cadena a una respuesta
// JSON con forma estable: { error, code, details? }. `error` SIEMPRE es
// texto apto para mostrarle a una persona — nunca un stack, nunca un
// "409 Conflict" pelado (prompt.txt §59).

function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada.', code: 'ROUTE_NOT_FOUND' });
}

function errorHandler(err, req, res, _next) {
  const log = req.log || logger;

  // 1. Validación de DTO con zod → 422 con el detalle de cada campo.
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: 'Revisá los datos del formulario.',
      code: 'VALIDATION',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  // 2. Errores de dominio → su propio status/código/mensaje.
  if (err instanceof DomainError) {
    if (err.status >= 500) log.error('domain_error_5xx', { code: err.code, msg: err.message });
    return res
      .status(err.status)
      .json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
  }

  // 3. Choques de clave única de MySQL que no se atajaron antes → 409 legible.
  if (err && err.code === 'ER_DUP_ENTRY') {
    log.warn('db_dup_entry', { sqlMessage: err.sqlMessage });
    return res
      .status(409)
      .json({ error: 'Ya existe un registro con esos datos.', code: 'CONFLICT' });
  }
  if (err && (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2')) {
    return res.status(409).json({
      error: 'La operación choca con datos relacionados.',
      code: 'FK_CONFLICT',
    });
  }

  // 4. Cualquier otra cosa → 500 genérico. El detalle queda SOLO en el log.
  log.error('unhandled_error', {
    message: err && err.message,
    stack: err && err.stack,
    code: err && err.code,
  });
  res.status(500).json({
    error: 'Ocurrió un error inesperado. Ya quedó registrado; probá de nuevo en un momento.',
    code: 'INTERNAL',
  });
}

module.exports = { errorHandler, notFound };
