const repo = require('./analytics.repository');
const branchRepo = require('../platform/branches.repository');
const { toCents, fromCents } = require('../catalog/pricing');
const { withTransaction } = require('../../withTransaction');
const { ValidationError } = require('../../errors');

async function assertBranch(tenantId, branchId) {
  if (!(await branchRepo.findById(tenantId, branchId))) throw new ValidationError('Esa sucursal no existe.');
}

// GMV/Revenue/Average Ticket/Orders/Customers/Repeat Rate/Preparation Time
// del prompt.txt §51 — LTV/Conversion/Stock Turnover/Waste/Food Cost/Gross
// Margin quedan afuera: no hay un método de costeo definido para los
// ingredientes (purchase_items.unit_cost es por compra, no un "costo
// actual"), y LTV/Conversion necesitan datos que este sistema no registra
// (tráfico/visitas). Ver FASE12.md.
async function salesSummary(tenantId, { branchId, from, to }) {
  await assertBranch(tenantId, branchId);
  const [summary, refunds, repeat] = await Promise.all([
    repo.salesSummary(tenantId, branchId, from, to),
    repo.refundsTotal(tenantId, branchId, from, to),
    repo.repeatCustomers(tenantId, branchId, from, to),
  ]);
  const ordersCount = Number(summary.orders_count);
  const netCents = toCents(summary.net);
  const avgTicketCents = ordersCount > 0 ? Math.round(netCents / ordersCount) : 0;
  return {
    from, to, ordersCount,
    gross: summary.gross, discounts: summary.discounts, net: summary.net, tips: summary.tips,
    refunds: fromCents(toCents(refunds)),
    avgTicket: fromCents(avgTicketCents),
    customers: Number(summary.customers),
    repeatCustomers: repeat.repeatCustomers,
    repeatRate: repeat.distinctCustomers > 0 ? Number((repeat.repeatCustomers / repeat.distinctCustomers).toFixed(4)) : 0,
    avgPrepMinutes: summary.avg_prep_minutes != null ? Number(Number(summary.avg_prep_minutes).toFixed(1)) : null,
  };
}

async function topProducts(tenantId, { branchId, from, to, limit }) {
  await assertBranch(tenantId, branchId);
  const rows = await repo.topProducts(tenantId, branchId, from, to, { limit });
  return rows.map((r) => ({ productId: r.product_id, name: r.name, qty: r.qty, gross: r.gross }));
}

async function dailySeries(tenantId, { branchId, from, to }) {
  await assertBranch(tenantId, branchId);
  const [sales, refunds] = await Promise.all([
    repo.dailySeries(tenantId, branchId, from, to),
    repo.dailyRefunds(tenantId, branchId, from, to),
  ]);
  const refundsByDate = new Map(refunds.map((r) => [r.date, r.refunds]));
  return sales.map((d) => ({
    date: d.date, ordersCount: Number(d.orders_count), gross: d.gross, discounts: d.discounts, net: d.net, tips: d.tips,
    refunds: refundsByDate.get(d.date) ?? '0.00',
    avgTicket: fromCents(Number(d.orders_count) > 0 ? Math.round(toCents(d.net) / Number(d.orders_count)) : 0),
  }));
}

// Puebla daily_sales_rollup/product_sales_rollup a partir de las mismas
// consultas directas — no es el camino que usa el dashboard de esta fase
// (ver la migración), pero deja el esquema de ARQUITECTURA_V1 realmente
// funcional, no vacío.
async function recomputeRollup(tenantId, { branchId, from, to }) {
  await assertBranch(tenantId, branchId);
  const [daily, dailyProducts] = await Promise.all([
    repo.dailySeries(tenantId, branchId, from, to),
    repo.dailyProductSeries(tenantId, branchId, from, to),
  ]);
  const refunds = await repo.dailyRefunds(tenantId, branchId, from, to);
  const refundsByDate = new Map(refunds.map((r) => [r.date, r.refunds]));

  await withTransaction(async (conn) => {
    for (const d of daily) {
      const ordersCount = Number(d.orders_count);
      const avgTicketCents = ordersCount > 0 ? Math.round(toCents(d.net) / ordersCount) : 0;
      await repo.upsertDailyRollup(tenantId, branchId, {
        date: d.date, ordersCount, gross: d.gross, discounts: d.discounts, net: d.net, tips: d.tips,
        refunds: refundsByDate.get(d.date) ?? '0.00', avgTicket: fromCents(avgTicketCents),
      }, conn);
    }
    for (const p of dailyProducts) {
      await repo.upsertProductRollup(tenantId, branchId, { date: p.date, productId: p.product_id, qty: p.qty, gross: p.gross }, conn);
    }
  });
  return { daysRecomputed: daily.length, productDaysRecomputed: dailyProducts.length };
}

async function getDailyRollup(tenantId, { branchId, from, to }) {
  await assertBranch(tenantId, branchId);
  return repo.listDailyRollup(tenantId, branchId, from, to);
}

module.exports = { salesSummary, topProducts, dailySeries, recomputeRollup, getDailyRollup };
