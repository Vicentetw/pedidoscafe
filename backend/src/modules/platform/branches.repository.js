const pool = require('../../db');

// Repo de `branches`. TODA consulta filtra por tenant_id — regla de oro
// del backend (ARQUITECTURA_V1 §13). `tenantId` es siempre el 1er argumento.

async function list(tenantId, { includeDeleted = false } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, tenant_id, code, name, timezone, address_json, status, created_at, updated_at, deleted_at
       FROM branches
      WHERE tenant_id = :tenantId
        ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
      ORDER BY name`,
    { tenantId }
  );
  return rows;
}

async function findById(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, code, name, timezone, address_json, status, created_at, updated_at, deleted_at
       FROM branches
      WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id }
  );
  return row || null;
}

async function findByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM branches WHERE tenant_id = :tenantId AND code = :code`,
    { tenantId, code }
  );
  return row || null;
}

async function create(tenantId, data, actorUserId, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO branches (tenant_id, code, name, timezone, address_json, status, created_by, updated_by)
     VALUES (:tenantId, :code, :name, :timezone, CAST(:address AS JSON), :status, :actor, :actor)`,
    {
      tenantId,
      code: data.code,
      name: data.name,
      timezone: data.timezone,
      address: data.address ? JSON.stringify(data.address) : null,
      status: data.status || 'active',
      actor: actorUserId ?? null,
    }
  );
  return res.insertId;
}

async function update(tenantId, id, patch, actorUserId, conn = pool) {
  const fields = ['updated_by = :actor'];
  const params = { tenantId, id, actor: actorUserId ?? null };
  for (const k of ['code', 'name', 'timezone', 'status']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = :${k}`);
      params[k] = patch[k];
    }
  }
  if (patch.address !== undefined) {
    fields.push('address_json = CAST(:address AS JSON)');
    params.address = patch.address ? JSON.stringify(patch.address) : null;
  }
  await conn.query(`UPDATE branches SET ${fields.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, params);
}

async function softDelete(tenantId, id, conn = pool) {
  await conn.query(
    `UPDATE branches SET deleted_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
}

module.exports = { list, findById, findByCode, create, update, softDelete };
