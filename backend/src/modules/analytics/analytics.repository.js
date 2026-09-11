const pool = require('../../db');

// Repo analítica: todo lee de tablas de otros módulos (orders, order_items,
// refunds/payments) — este módulo no escribe en ellas, sólo en su propio
// rollup. tenantId primero; todo WHERE lo lleva. `from`/`to` son fechas
// 'YYYY-MM-DD'; `to` se trata como INCLUSIVE (se arma el rango con
// DATE_ADD(:to, INTERVAL 1 DAY) como cota exclusiva).

async function salesSummary(tenantId, branchId, from, to, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS orders_count, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount_total),0) AS discounts,
            COALESCE(SUM(total),0) AS net, COALESCE(SUM(tip_total),0) AS tips,
            COUNT(DISTINCT customer_id) AS customers,
            AVG(CASE WHEN accepted_at IS NOT NULL AND ready_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, accepted_at, ready_at) END) AS avg_prep_minutes
       FROM orders
      WHERE tenant_id = :tenantId AND branch_id = :branchId AND payment_status = 'PAID'
        AND created_at >= :from AND created_at < DATE_ADD(:to, INTERVAL 1 DAY)`,
    { tenantId, branchId, from, to }
  );
  return row;
}

async function refundsTotal(tenantId, branchId, from, to, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(r.amount),0) AS refunds
       FROM refunds r JOIN payments p ON p.id = r.payment_id
      WHERE p.tenant_id = :tenantId AND p.branch_id = :branchId AND r.status = 'APPROVED'
        AND r.created_at >= :from AND r.created_at < DATE_ADD(:to, INTERVAL 1 DAY)`,
    { tenantId, branchId, from, to }
  );
  return row.refunds;
}

// Cuántos clientes identificados compraron más de una vez en el período —
// base de "repeat rate". Devuelve {distinctCustomers, repeatCustomers}.
async function repeatCustomers(tenantId, branchId, from, to, conn = pool) {
  const [rows] = await conn.query(
    `SELECT customer_id, COUNT(*) AS n
       FROM orders
      WHERE tenant_id = :tenantId AND branch_id = :branchId AND payment_status = 'PAID' AND customer_id IS NOT NULL
        AND created_at >= :from AND created_at < DATE_ADD(:to, INTERVAL 1 DAY)
      GROUP BY customer_id`,
    { tenantId, branchId, from, to }
  );
  return { distinctCustomers: rows.length, repeatCustomers: rows.filter((r) => r.n > 1).length };
}

async function topProducts(tenantId, branchId, from, to, { limit = 10 } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT oi.product_id, ANY_VALUE(oi.name_snapshot) AS name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS gross
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = :tenantId AND o.branch_id = :branchId AND o.payment_status = 'PAID'
        AND o.created_at >= :from AND o.created_at < DATE_ADD(:to, INTERVAL 1 DAY)
      GROUP BY oi.product_id
      ORDER BY gross DESC LIMIT :limit`,
    { tenantId, branchId, from, to, limit: Number(limit) }
  );
  return rows;
}

async function dailySeries(tenantId, branchId, from, to, conn = pool) {
  const [rows] = await conn.query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS orders_count, COALESCE(SUM(subtotal),0) AS gross,
            COALESCE(SUM(discount_total),0) AS discounts, COALESCE(SUM(total),0) AS net, COALESCE(SUM(tip_total),0) AS tips
       FROM orders
      WHERE tenant_id = :tenantId AND branch_id = :branchId AND payment_status = 'PAID'
        AND created_at >= :from AND created_at < DATE_ADD(:to, INTERVAL 1 DAY)
      GROUP BY DATE(created_at) ORDER BY date`,
    { tenantId, branchId, from, to }
  );
  return rows;
}

async function dailyProductSeries(tenantId, branchId, from, to, conn = pool) {
  const [rows] = await conn.query(
    `SELECT DATE(o.created_at) AS date, oi.product_id, SUM(oi.qty) AS qty, SUM(oi.line_total) AS gross
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = :tenantId AND o.branch_id = :branchId AND o.payment_status = 'PAID'
        AND o.created_at >= :from AND o.created_at < DATE_ADD(:to, INTERVAL 1 DAY)
      GROUP BY DATE(o.created_at), oi.product_id`,
    { tenantId, branchId, from, to }
  );
  return rows;
}

async function dailyRefunds(tenantId, branchId, from, to, conn = pool) {
  const [rows] = await conn.query(
    `SELECT DATE(r.created_at) AS date, COALESCE(SUM(r.amount),0) AS refunds
       FROM refunds r JOIN payments p ON p.id = r.payment_id
      WHERE p.tenant_id = :tenantId AND p.branch_id = :branchId AND r.status = 'APPROVED'
        AND r.created_at >= :from AND r.created_at < DATE_ADD(:to, INTERVAL 1 DAY)
      GROUP BY DATE(r.created_at)`,
    { tenantId, branchId, from, to }
  );
  return rows;
}

// -------- rollup (persistido; ver nota en la migración)
async function upsertDailyRollup(tenantId, branchId, row, conn) {
  await conn.query(
    `INSERT INTO daily_sales_rollup (tenant_id, branch_id, date, orders_count, gross, discounts, net, tips, refunds, avg_ticket)
     VALUES (:tenantId, :branchId, :date, :ordersCount, :gross, :discounts, :net, :tips, :refunds, :avgTicket)
     ON DUPLICATE KEY UPDATE orders_count = VALUES(orders_count), gross = VALUES(gross), discounts = VALUES(discounts),
       net = VALUES(net), tips = VALUES(tips), refunds = VALUES(refunds), avg_ticket = VALUES(avg_ticket)`,
    { tenantId, branchId, ...row }
  );
}
async function upsertProductRollup(tenantId, branchId, row, conn) {
  await conn.query(
    `INSERT INTO product_sales_rollup (tenant_id, branch_id, date, product_id, qty, gross)
     VALUES (:tenantId, :branchId, :date, :productId, :qty, :gross)
     ON DUPLICATE KEY UPDATE qty = VALUES(qty), gross = VALUES(gross)`,
    { tenantId, branchId, ...row }
  );
}
async function listDailyRollup(tenantId, branchId, from, to, conn = pool) {
  const [rows] = await conn.query(
    `SELECT date, orders_count, gross, discounts, net, tips, refunds, avg_ticket, computed_at
       FROM daily_sales_rollup WHERE tenant_id = :tenantId AND branch_id = :branchId AND date BETWEEN :from AND :to
      ORDER BY date`,
    { tenantId, branchId, from, to }
  );
  return rows;
}

module.exports = {
  salesSummary, refundsTotal, repeatCustomers, topProducts, dailySeries, dailyProductSeries, dailyRefunds,
  upsertDailyRollup, upsertProductRollup, listDailyRollup,
};
