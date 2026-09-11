const pool = require('./db');

// Único lugar que abre transacciones. Los repositories aceptan un `conn`
// opcional (default: el pool) para poder participar de la transacción del
// service que los llama, o correr sueltos.
//
//   await withTransaction(async (conn) => {
//     await stockRepo.reserve(tenantId, ..., conn);
//     await orderRepo.setStatus(tenantId, orderId, 'CONFIRMED', conn);
//   });
//
// Si el callback tira, se hace ROLLBACK y se re-lanza el error tal cual.
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* la conexión ya puede estar rota; el release de abajo la descarta */
    }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { withTransaction };
