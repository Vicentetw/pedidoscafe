const pool = require('../db');
const repo = require('../modules/inventory/inventory.repository');
const stockService = require('../modules/inventory/stock.service');
const { withTransaction } = require('../withTransaction');
const { logger } = require('../logger');

// Libera las reservas de stock ACTIVE que pasaron su expires_at (pedidos
// que quedaron colgados / abandonados). ARQUITECTURA_V1 §8, §12.
let timer = null;

async function runOnce() {
  const expired = await repo.findExpiredActiveReservations(200);
  if (!expired.length) return 0;
  const byOrder = new Map();
  for (const r of expired) {
    if (!byOrder.has(r.order_id)) byOrder.set(r.order_id, r.tenant_id);
  }
  let released = 0;
  for (const [orderId, tenantId] of byOrder) {
    try {
      await withTransaction((conn) => stockService.releaseForOrder(tenantId, orderId, conn));
      released++;
    } catch (err) {
      logger.error('release_expired_failed', { orderId, message: err.message });
    }
  }
  logger.info('released_expired_reservations', { orders: released });
  return released;
}

function start({ intervalMs = 60000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error('release_expired_worker_error', { message: err.message }));
  }, intervalMs);
  timer.unref?.();
  logger.info('release_expired_worker_started', { intervalMs });
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce };
