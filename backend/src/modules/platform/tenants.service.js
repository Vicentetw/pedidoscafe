const repo = require('./tenants.repository');
const { NotFoundError, ConflictError } = require('../../errors');
const { writeAudit } = require('../../audit/audit');

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function listTenants(query) {
  return repo.list(query);
}

async function getTenant(id) {
  const t = await repo.findById(id);
  if (!t) throw new NotFoundError('No existe esa empresa.');
  return t;
}

async function createTenant(input, req) {
  const slug = input.slug || slugify(input.name);
  if (!slug) throw new ConflictError('No se pudo generar un identificador para esa empresa; indicá un "slug".');
  if (await repo.findBySlug(slug)) throw new ConflictError('Ya existe una empresa con ese identificador (slug).');

  const id = await repo.create({ name: input.name, slug });
  await writeAudit(
    { req, tenantId: id, entityType: 'tenant', entityId: id, action: 'create', after: { name: input.name, slug } },
  );
  return repo.findById(id);
}

async function updateTenant(id, patch, req) {
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('No existe esa empresa.');
  if (patch.slug && patch.slug !== before.slug && (await repo.findBySlug(patch.slug))) {
    throw new ConflictError('Ya existe una empresa con ese identificador (slug).');
  }
  await repo.update(id, patch);
  const after = await repo.findById(id);
  await writeAudit({ req, tenantId: id, entityType: 'tenant', entityId: id, action: 'update', before, after });
  return after;
}

module.exports = { listTenants, getTenant, createTenant, updateTenant, slugify };
