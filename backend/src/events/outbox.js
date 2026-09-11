const pool = require('../db');
const { bus } = require('./bus');
const { logger } = require('../logger');

// Outbox transaccional. Un service que quiere emitir un evento de forma
// durable inserta una fila en domain_events DENTRO de su misma transacción
// (pasando `conn`). Un worker la levanta después y la despacha al bus (y a
// futuro: a consumidores externos / analytics). Así el evento no se pierde
// si el proceso muere entre el COMMIT y el emit, y no se emite si la
// transacción hace ROLLBACK.

/**
 * @param {object} conn  conexión DENTRO de la transacción del service
 * @param {{ tenantId:number, branchId?:number|null, type:string, payload:object }} evt
 */
async function enqueue(conn, { tenantId, branchId = null, type, payload }) {
  await conn.query(
    `INSERT INTO domain_events (tenant_id, branch_id, type, payload)
     VALUES (:tenantId, :branchId, :type, CAST(:payload AS JSON))`,
    { tenantId, branchId, type, payload: JSON.stringify(payload ?? {}) }
  );
}

let timer = null;

async function dispatchOnce(limit = 100) {
  const [rows] = await pool.query(
    `SELECT id, tenant_id, branch_id, type, payload
       FROM domain_events
      WHERE dispatched_at IS NULL
      ORDER BY id
      LIMIT :limit`,
    { limit }
  );
  for (const row of rows) {
    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      bus.emitEvent(row.type, { tenantId: row.tenant_id, branchId: row.branch_id, ...payload });
      await pool.query(
        `UPDATE domain_events SET dispatched_at = CURRENT_TIMESTAMP(3) WHERE id = :id`,
        { id: row.id }
      );
    } catch (err) {
      await pool.query(`UPDATE domain_events SET attempts = attempts + 1 WHERE id = :id`, { id: row.id });
      logger.error('outbox_dispatch_failed', { id: row.id, type: row.type, message: err.message });
    }
  }
  return rows.length;
}

function startOutboxWorker({ intervalMs = 1000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    dispatchOnce().catch((err) => logger.error('outbox_worker_error', { message: err.message }));
  }, intervalMs);
  timer.unref?.();
  logger.info('outbox_worker_started', { intervalMs });
}

function stopOutboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { enqueue, dispatchOnce, startOutboxWorker, stopOutboxWorker };
