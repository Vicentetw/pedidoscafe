const repo = require('./fiscal.repository');
const branchRepo = require('../platform/branches.repository');
const ordersRepo = require('../orders/orders.repository');
const tablesRepo = require('../tables/tables.repository');
const { toCents, fromCents } = require('../catalog/pricing');
const { withTransaction } = require('../../withTransaction');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError, DomainError } = require('../../errors');
const ticketProvider = require('./providers/ticketNoFiscal.provider');
const afipProvider = require('./providers/afip.provider');

const actorOf = (req) => req?.appUser?.id ?? null;

async function getConfig(tenantId, branchId) {
  if (!(await branchRepo.findById(tenantId, branchId))) throw new NotFoundError('Esa sucursal no existe.');
  const config = await repo.getConfig(tenantId, branchId);
  return config || { tenant_id: tenantId, branch_id: branchId, cuit: null, point_of_sale_no: null, environment: 'HOMOLOGACION', default_doc_type: 'TICKET' };
}
async function setConfig(tenantId, branchId, input, req) {
  if (!(await branchRepo.findById(tenantId, branchId))) throw new ValidationError('Esa sucursal no existe.');
  const before = await repo.getConfig(tenantId, branchId);
  const after = await repo.upsertConfig(tenantId, branchId, input);
  await writeAudit({ req, tenantId, branchId, entityType: 'fiscal_config', entityId: branchId, action: 'set', before, after: input });
  return after;
}

async function listTaxRates(tenantId) {
  return repo.listTaxRates(tenantId);
}
async function createTaxRate(tenantId, input, req) {
  const id = await repo.createTaxRate(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'tax_rate', entityId: id, action: 'create', after: input });
  return id;
}

// Reparte un total (con impuestos incluidos, como se muestra en el menú)
// en neto + IVA usando una alícuota porcentual. Todo en centavos.
function splitNetTax(totalCents, ratePercent) {
  const netCents = Math.round(totalCents / (1 + ratePercent / 100));
  const taxCents = totalCents - netCents;
  return { netCents, taxCents };
}

async function resolveTaxRate(tenantId) {
  const def = await repo.getDefaultTaxRate(tenantId);
  return def ? Number(def.rate) : 0; // sin alícuota configurada -> neto = total, IVA 0 (no se inventa una tasa)
}

async function issueDocument(tenantId, { branchId, orderId = null, sessionId = null, lines, totalCents, customerDocType, customerDocNo }, actor) {
  const config = await getConfig(tenantId, branchId);
  const posNo = config.point_of_sale_no ?? 0;
  const ratePercent = await resolveTaxRate(tenantId);
  const taxRate = await repo.getDefaultTaxRate(tenantId);

  const result = await withTransaction(async (conn) => {
    let issued;
    let fellBack = false;
    const wantsReal = config.default_doc_type !== 'TICKET' && config.cuit;
    if (wantsReal) {
      try {
        // Seam real (Fase 8 completa) — ver providers/afip.provider.js
        issued = await afipProvider.requestCAE({ tenantId, branchId, config, totalCents, conn });
      } catch (err) {
        if (err.code !== 'AFIP_NOT_CONFIGURED') throw err;
        fellBack = true;
      }
    }
    if (!issued) {
      issued = await ticketProvider.issue({ tenantId, branchId, posNo, repo, conn });
    }

    const { netCents, taxCents } = splitNetTax(totalCents, ratePercent);
    const { id: documentId, publicId } = await repo.createDocument(tenantId, {
      branchId, orderId, sessionId, docType: issued.docType, posNo, number: issued.number,
      cae: issued.cae, caeExpiresAt: issued.caeExpiresAt, status: issued.status,
      net: fromCents(netCents), tax: fromCents(taxCents), total: fromCents(totalCents),
      customerDocType: customerDocType ?? 'CF', customerDocNo: customerDocNo ?? null, createdBy: actor.actorId ?? null,
    }, conn);

    for (const line of lines) {
      const lineTotalCents = toCents(line.total);
      const { netCents: lineNet, taxCents: lineTax } = splitNetTax(lineTotalCents, ratePercent);
      await repo.addDocumentItem(documentId, {
        description: line.description, qty: line.qty, unitPrice: line.unitPrice,
        net: fromCents(lineNet), taxRateId: taxRate ? taxRate.id : null, tax: fromCents(lineTax), total: line.total,
      }, conn);
    }
    return { documentId, publicId, fellBack };
  });

  await writeAudit({
    req: actor.req, tenantId, branchId, entityType: 'fiscal_document', entityId: result.documentId, action: 'issue',
    after: { orderId, sessionId, total: fromCents(totalCents) },
  });
  return { ...(await getDocument(tenantId, result.documentId)), fellBackToTicket: result.fellBack };
}

async function issueForOrder(tenantId, orderId, input, actor) {
  const existing = await repo.findDocumentForOrder(tenantId, orderId);
  if (existing) return getDocument(tenantId, existing.id); // idempotente — nunca un 2º comprobante para el mismo pedido

  const order = await ordersRepo.findOrder(tenantId, orderId);
  if (!order) throw new NotFoundError('Ese pedido no existe.');
  if (order.session_id) throw new ValidationError('Ese pedido pertenece a una mesa; emitilo desde la mesa.');
  if (order.payment_status !== 'PAID') throw new ConflictError('Ese pedido todavía no está pagado.');

  const items = await ordersRepo.listItems(tenantId, orderId);
  const lines = items.map((it) => ({
    description: it.name_snapshot + (it.variant_snapshot ? ` (${it.variant_snapshot})` : ''),
    qty: it.qty, unitPrice: it.unit_price, total: it.line_total,
  }));
  return issueDocument(tenantId, {
    branchId: order.branch_id, orderId, lines, totalCents: toCents(order.total),
    customerDocType: input.customerDocType, customerDocNo: input.customerDocNo,
  }, actor);
}

async function issueForSession(tenantId, sessionId, input, actor) {
  const existing = await repo.findDocumentForSession(tenantId, sessionId);
  if (existing) return getDocument(tenantId, existing.id);

  const session = await tablesRepo.findSessionById(tenantId, sessionId);
  if (!session) throw new NotFoundError('Esa mesa no existe.');
  if (toCents(session.paid_amount) < toCents(session.total_amount) || toCents(session.total_amount) === 0) {
    throw new ConflictError('Esa mesa todavía no está saldada.');
  }
  const orders = await ordersRepo.listOrders(tenantId, { sessionId });
  const lines = [];
  for (const o of orders.filter((x) => ['CONFIRMED', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'COMPLETED'].includes(x.status))) {
    for (const it of await ordersRepo.listItems(tenantId, o.id)) {
      lines.push({
        description: it.name_snapshot + (it.variant_snapshot ? ` (${it.variant_snapshot})` : ''),
        qty: it.qty, unitPrice: it.unit_price, total: it.line_total,
      });
    }
  }
  return issueDocument(tenantId, {
    branchId: session.branch_id, sessionId, lines, totalCents: toCents(session.total_amount),
    customerDocType: input.customerDocType, customerDocNo: input.customerDocNo,
  }, actor);
}

async function getDocument(tenantId, id) {
  const doc = await repo.findDocument(tenantId, id);
  if (!doc) throw new NotFoundError('Ese comprobante no existe.');
  const items = await repo.listDocumentItems(id);
  return { ...doc, items };
}
async function listDocuments(tenantId, branchId) {
  if (!(await branchRepo.findById(tenantId, branchId))) throw new ValidationError('Esa sucursal no existe.');
  return repo.listDocuments(tenantId, branchId);
}

module.exports = {
  getConfig, setConfig, listTaxRates, createTaxRate,
  issueForOrder, issueForSession, getDocument, listDocuments,
};
