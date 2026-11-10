const tablesService = require('../modules/tables/tables.service');
const { logger } = require('../logger');

// Cierre automático de mesas sin consumo o ya saldadas (falla 8, parte 2A;
// reglas en modules/tables/tables.housekeeping.js). Cada 5 min: los plazos
// configurables son de minutos, no hace falta más fino.
let timer = null;

async function runOnce() {
  const res = await tablesService.runHousekeeping();
  if (res.released || res.closed) logger.info('table_housekeeping', res);
  return res;
}

function start({ intervalMs = 5 * 60 * 1000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error('table_housekeeping_error', { message: err.message }));
  }, intervalMs);
  timer.unref?.();
  logger.info('table_housekeeping_started', { intervalMs });
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce };
