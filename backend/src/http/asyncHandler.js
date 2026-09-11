// Express 5 ya reenvía promesas rechazadas al errorHandler, pero envolver
// explícito deja la intención clara y cubre middlewares que no son la
// ruta final. Uso: router.get('/', asyncHandler(async (req, res) => {...}))
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
