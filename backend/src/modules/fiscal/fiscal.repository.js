const { ulid } = require('ulid');
const pool = require('../../db');

// Repo fiscal: config por sucursal, alícuotas, comprobantes + ítems,
// numeración correlativa. tenantId primero; todo WHERE lo lleva.

// -------- config
async function getConfig(tenantId, branchId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, branch_id, cuit, point_of_sale_no, cert_ref, environment, default_doc_type
       FROM fiscal_config WHERE tenant_id = :tenantId AND branch_id = :branchId`,
    { tenantId, branchId }
  );
  return row || null;
}
async function upsertConfig(tenantId, branchId, d, conn = pool) {
  await conn.query(
    `INSERT INTO fiscal_config (tenant_id, branch_id, cuit, point_of_sale_no, environment, default_doc_type)
     VALUES (:tenantId, :branchId, :cuit, :posNo, :environment, :defaultDocType)
     ON DUPLICATE KEY UPDATE cuit = VALUES(cuit), point_of_sale_no = VALUES(point_of_sale_no),
       environment = VALUES(environment), default_doc_type = VALUES(default_doc_type)`,
    { tenantId, branchId, cuit: d.cuit ?? null, posNo: d.pointOfSaleNo ?? null, environment: d.environment ?? 'HOMOLOGACION', defaultDocType: d.defaultDocType ?? 'TICKET' }
  );
  return getConfig(tenantId, branchId, conn);
}

// -------- alícuotas
async function listTaxRates(tenantId, conn = pool) {
  const [rows] = await conn.query(`SELECT id, code, name, rate, is_default FROM tax_rates WHERE tenant_id = :tenantId ORDER BY name`, { tenantId });
  return rows;
}
async function findTaxRateByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(`SELECT id, rate FROM tax_rates WHERE tenant_id = :tenantId AND code = :code`, { tenantId, code });
  return row || null;
}
async function getDefaultTaxRate(tenantId, conn = pool) {
  const [[row]] = await conn.query(`SELECT id, code, rate FROM tax_rates WHERE tenant_id = :tenantId AND is_default = 1 LIMIT 1`, { tenantId });
  return row || null;
}
async function createTaxRate(tenantId, d, conn = pool) {
  if (d.isDefault) await conn.query(`UPDATE tax_rates SET is_default = 0 WHERE tenant_id = :tenantId`, { tenantId });
  const [r] = await conn.query(
    `INSERT INTO tax_rates (tenant_id, code, name, rate, is_default) VALUES (:tenantId, :code, :name, :rate, :isDefault)`,
    { tenantId, code: d.code, name: d.name, rate: d.rate, isDefault: d.isDefault ? 1 : 0 }
  );
  return r.insertId;
}

// -------- numeración
async function nextNumber(tenantId, branchId, posNo, docType, conn) {
  await conn.query(
    `INSERT INTO fiscal_document_counters (tenant_id, branch_id, point_of_sale_no, doc_type, last_number)
     VALUES (:tenantId, :branchId, :posNo, :docType, 1)
     ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
    { tenantId, branchId, posNo, docType }
  );
  const [[row]] = await conn.query(
    `SELECT last_number FROM fiscal_document_counters WHERE tenant_id = :tenantId AND branch_id = :branchId AND point_of_sale_no = :posNo AND doc_type = :docType`,
    { tenantId, branchId, posNo, docType }
  );
  return row.last_number;
}

// -------- comprobantes
async function createDocument(tenantId, d, conn = pool) {
  const publicId = ulid();
  const [r] = await conn.query(
    `INSERT INTO fiscal_documents (public_id, tenant_id, branch_id, order_id, session_id, doc_type, point_of_sale_no,
        number, cae, cae_expires_at, status, net_amount, tax_amount, total_amount, customer_doc_type, customer_doc_no, created_by)
     VALUES (:publicId, :tenantId, :branchId, :orderId, :sessionId, :docType, :posNo,
        :number, :cae, :caeExpiresAt, :status, :net, :tax, :total, :customerDocType, :customerDocNo, :createdBy)`,
    {
      publicId, tenantId, branchId: d.branchId, orderId: d.orderId ?? null, sessionId: d.sessionId ?? null,
      docType: d.docType, posNo: d.posNo, number: d.number ?? null, cae: d.cae ?? null, caeExpiresAt: d.caeExpiresAt ?? null,
      status: d.status ?? 'ISSUED', net: d.net, tax: d.tax, total: d.total,
      customerDocType: d.customerDocType ?? null, customerDocNo: d.customerDocNo ?? null, createdBy: d.createdBy ?? null,
    }
  );
  return { id: r.insertId, publicId };
}
async function addDocumentItem(documentId, d, conn = pool) {
  await conn.query(
    `INSERT INTO fiscal_document_items (document_id, description, qty, unit_price, net_amount, tax_rate_id, tax_amount, total_amount)
     VALUES (:documentId, :description, :qty, :unitPrice, :net, :taxRateId, :tax, :total)`,
    { documentId, description: d.description, qty: d.qty, unitPrice: d.unitPrice, net: d.net, taxRateId: d.taxRateId ?? null, tax: d.tax, total: d.total }
  );
}
async function findDocument(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, public_id, tenant_id, branch_id, order_id, session_id, doc_type, point_of_sale_no, number,
            cae, cae_expires_at, status, net_amount, tax_amount, total_amount, customer_doc_type, customer_doc_no, created_at
       FROM fiscal_documents WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id }
  );
  return row || null;
}
async function listDocumentItems(documentId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT description, qty, unit_price, net_amount, tax_amount, total_amount FROM fiscal_document_items WHERE document_id = :documentId`,
    { documentId }
  );
  return rows;
}
async function findDocumentForOrder(tenantId, orderId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, public_id, status FROM fiscal_documents WHERE tenant_id = :tenantId AND order_id = :orderId AND status != 'REJECTED' LIMIT 1`,
    { tenantId, orderId }
  );
  return row || null;
}
async function findDocumentForSession(tenantId, sessionId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, public_id, status FROM fiscal_documents WHERE tenant_id = :tenantId AND session_id = :sessionId AND status != 'REJECTED' LIMIT 1`,
    { tenantId, sessionId }
  );
  return row || null;
}
async function listDocuments(tenantId, branchId, { limit = 100 } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, public_id, doc_type, point_of_sale_no, number, status, total_amount, created_at
       FROM fiscal_documents WHERE tenant_id = :tenantId AND branch_id = :branchId
      ORDER BY created_at DESC LIMIT :limit`,
    { tenantId, branchId, limit: Number(limit) }
  );
  return rows;
}

module.exports = {
  getConfig, upsertConfig,
  listTaxRates, findTaxRateByCode, getDefaultTaxRate, createTaxRate,
  nextNumber, createDocument, addDocumentItem, findDocument, listDocumentItems,
  findDocumentForOrder, findDocumentForSession, listDocuments,
};
