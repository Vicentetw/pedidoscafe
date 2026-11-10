const { purgeDispatched } = require('../events/outbox');
const { logger } = require('../logger');

// Limpieza periódica de domain_events (ver purgeDispatched). Corre un rato
// después de arrancar —Render puede dormir el servicio y un intervalo
// diario podría no llegar nunca— y después cada `intervalMs`.
let timer = null;
let first = null;

async function runOnce() {
  const deleted = await purgeDispatched({ olderThanDays: 7 });
  if (deleted) logger.info('domain_events_purged', { deleted });
  return deleted;
}

function start({ intervalMs = 6 * 60 * 60 * 1000, firstRunMs = 60 * 1000 } = {}) {
  if (timer) return;
  const run = () => runOnce().catch((err) => logger.error('domain_events_purge_error', { message: err.message }));
  first = setTimeout(run, firstRunMs);
  first.unref?.();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
  logger.info('domain_events_purge_started', { intervalMs });
}
function stop() {
  if (first) clearTimeout(first);
  if (timer) clearInterval(timer);
  first = null;
  timer = null;
}

module.exports = { start, stop, runOnce };
