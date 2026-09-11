const pool = require('../../db');

// Repo de la tabla `tenants` — tabla de PLATAFORMA (sin tenant_id propio).
// Sólo la tocan rutas de superadmin, por eso no lleva scope de tenant.

async function list({ q, limit = 100, offset = 0 }, conn = pool) {
  const where = q ? 'WHERE name LIKE :like OR slug LIKE :like' : '';
  const [rows] = await conn.query(
    `SELECT t.id, t.name, t.slug, t.status, t.created_at,
            (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS branch_count,
            (SELECT COUNT(*) FROM app_users u WHERE u.tenant_id = t.id) AS user_count
       FROM tenants t
       ${where}
      ORDER BY t.created_at DESC
      LIMIT :limit OFFSET :offset`,
    { like: `%${q}%`, limit: Number(limit), offset: Number(offset) }
  );
  return rows;
}

async function findById(id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, name, slug, status, created_at, updated_at FROM tenants WHERE id = :id`,
    { id }
  );
  return row || null;
}

async function findBySlug(slug, conn = pool) {
  const [[row]] = await conn.query(`SELECT id FROM tenants WHERE slug = :slug`, { slug });
  return row || null;
}

async function create({ name, slug, status = 'active' }, conn = pool) {
  const [res] = await conn.query(
    `INSERT INTO tenants (name, slug, status) VALUES (:name, :slug, :status)`,
    { name, slug, status }
  );
  return res.insertId;
}

async function update(id, patch, conn = pool) {
  const fields = [];
  const params = { id };
  for (const k of ['name', 'slug', 'status']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = :${k}`);
      params[k] = patch[k];
    }
  }
  if (!fields.length) return;
  await conn.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = :id`, params);
}

module.exports = { list, findById, findBySlug, create, update };
