// Logs estructurados con correlation id. No es una librería: un JSON por
// línea a stdout alcanza para arrancar (observabilidad, prompt.txt §48).
// El middleware httpLogger cuelga req.log con el request_id ya adentro,
// así cada línea de un mismo request se puede correlacionar.
const { randomUUID } = require('crypto');

function emit(level, msg, fields) {
  const line = { ts: new Date().toISOString(), level, msg, ...fields };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

function make(base = {}) {
  return {
    child: (extra) => make({ ...base, ...extra }),
    debug: (msg, f) => emit('debug', msg, { ...base, ...f }),
    info: (msg, f) => emit('info', msg, { ...base, ...f }),
    warn: (msg, f) => emit('warn', msg, { ...base, ...f }),
    error: (msg, f) => emit('error', msg, { ...base, ...f }),
  };
}

const logger = make();

// Middleware: request_id (respeta uno entrante en x-request-id), log de
// entrada/salida con duración y status.
function httpLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader('x-request-id', requestId);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    req.log.info('http', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms),
      tenantId: req.appUser?.tenantId ?? req.tableSession?.tenantId ?? null,
    });
  });
  next();
}

module.exports = { logger, httpLogger };
