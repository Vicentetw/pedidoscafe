const pool = require('../../db');

// settings: pares clave→valor JSON por empresa, opcionalmente por sucursal
// (branch_id NULL = valor a nivel empresa). Resolución efectiva: el valor
// de la sucursal pisa al de la empresa.

async function getAll(tenantId, branchId = null, conn = pool) {
  const [rows] = await conn.query(
    `SELECT \`key\`, value, branch_id
       FROM settings
      WHERE tenant_id = :tenantId AND (branch_id IS NULL OR branch_id = :branchId)`,
    { tenantId, branchId }
  );
  // Sucursal pisa empresa.
  const out = {};
  for (const r of rows.filter((x) => x.branch_id == null)) out[r.key] = parse(r.value);
  for (const r of rows.filter((x) => x.branch_id != null)) out[r.key] = parse(r.value);
  return out;
}

async function get(tenantId, key, branchId = null, conn = pool) {
  const [rows] = await conn.query(
    `SELECT value, branch_id FROM settings
      WHERE tenant_id = :tenantId AND \`key\` = :key AND (branch_id IS NULL OR branch_id = :branchId)
      ORDER BY branch_id IS NULL`,
    { tenantId, key, branchId }
  );
  return rows.length ? parse(rows[rows.length - 1].value) : undefined;
}

async function set(tenantId, key, value, { branchId = null, updatedBy = null } = {}, conn = pool) {
  await conn.query(
    `INSERT INTO settings (tenant_id, branch_id, \`key\`, value, updated_by)
     VALUES (:tenantId, :branchId, :key, CAST(:value AS JSON), :updatedBy)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
    { tenantId, branchId, key, value: JSON.stringify(value), updatedBy }
  );
}

// mysql2 ya devuelve las columnas JSON parseadas a valor JS. Si alguna
// versión del driver devolviera el string crudo, se intenta parsear y se
// cae al valor tal cual si no es JSON válido.
function parse(v) {
  if (v == null || typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

module.exports = { getAll, get, set };
