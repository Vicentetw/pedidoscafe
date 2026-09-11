const repo = require('./branches.repository');
const { NotFoundError, ConflictError } = require('../../errors');
const { writeAudit } = require('../../audit/audit');

async function listBranches(tenantId) {
  return repo.list(tenantId);
}

async function getBranch(tenantId, id) {
  const b = await repo.findById(tenantId, id);
  if (!b || b.deleted_at) throw new NotFoundError('No existe esa sucursal.');
  return b;
}

async function createBranch(tenantId, input, req) {
  if (await repo.findByCode(tenantId, input.code)) {
    throw new ConflictError('Ya existe una sucursal con ese código en tu empresa.');
  }
  const id = await repo.create(tenantId, input, req.appUser?.id);
  const after = await repo.findById(tenantId, id);
  await writeAudit({ req, tenantId, branchId: id, entityType: 'branch', entityId: id, action: 'create', after });
  return after;
}

async function updateBranch(tenantId, id, patch, req) {
  const before = await repo.findById(tenantId, id);
  if (!before || before.deleted_at) throw new NotFoundError('No existe esa sucursal.');
  if (patch.code && patch.code !== before.code) {
    const clash = await repo.findByCode(tenantId, patch.code);
    if (clash && clash.id !== id) throw new ConflictError('Ya existe una sucursal con ese código.');
  }
  await repo.update(tenantId, id, patch, req.appUser?.id);
  const after = await repo.findById(tenantId, id);
  await writeAudit({ req, tenantId, branchId: id, entityType: 'branch', entityId: id, action: 'update', before, after });
  return after;
}

async function deleteBranch(tenantId, id, req) {
  const before = await repo.findById(tenantId, id);
  if (!before || before.deleted_at) throw new NotFoundError('No existe esa sucursal.');
  await repo.softDelete(tenantId, id);
  await writeAudit({ req, tenantId, branchId: id, entityType: 'branch', entityId: id, action: 'delete', before });
}

module.exports = { listBranches, getBranch, createBranch, updateBranch, deleteBranch };
