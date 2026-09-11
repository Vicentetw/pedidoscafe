const repo = require('./crm.repository');
const branchRepo = require('../platform/branches.repository');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { writeAudit } = require('../../audit/audit');

async function createCustomer(tenantId, input, req) {
  if (input.homeBranchId && !(await branchRepo.findById(tenantId, input.homeBranchId))) {
    throw new ValidationError('Esa sucursal no existe.');
  }
  if (input.phone || input.email) {
    const dup = await repo.findByPhoneOrEmail(tenantId, { phone: input.phone, email: input.email });
    if (dup) throw new ConflictError('Ya existe un cliente con ese teléfono o email.', { code: 'CUSTOMER_DUPLICATE' });
  }
  const id = await repo.createCustomer(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'customer', entityId: id, action: 'create', after: input });
  return getCustomer(tenantId, id);
}

async function updateCustomer(tenantId, id, input, req) {
  const before = await repo.findCustomer(tenantId, id);
  if (!before) throw new NotFoundError('Ese cliente no existe.');
  if (input.homeBranchId && !(await branchRepo.findById(tenantId, input.homeBranchId))) {
    throw new ValidationError('Esa sucursal no existe.');
  }
  if (input.phone || input.email) {
    const dup = await repo.findByPhoneOrEmail(tenantId, { phone: input.phone, email: input.email });
    if (dup && dup.id !== id) throw new ConflictError('Ya existe otro cliente con ese teléfono o email.', { code: 'CUSTOMER_DUPLICATE' });
  }
  await repo.updateCustomer(tenantId, id, input);
  await writeAudit({ req, tenantId, entityType: 'customer', entityId: id, action: 'update', before, after: input });
  return getCustomer(tenantId, id);
}

async function getCustomer(tenantId, id) {
  const c = await repo.findCustomer(tenantId, id);
  if (!c) throw new NotFoundError('Ese cliente no existe.');
  return c;
}

async function listCustomers(tenantId, query) {
  return repo.listCustomers(tenantId, query);
}

async function setPreference(tenantId, customerId, key, value, req) {
  await getCustomer(tenantId, customerId); // 404 si no existe / no es de este tenant
  await repo.setPreference(tenantId, customerId, key, value);
  await writeAudit({ req, tenantId, entityType: 'customer_preference', entityId: customerId, action: 'set', after: { key, value } });
  return repo.listPreferences(tenantId, customerId);
}
async function listPreferences(tenantId, customerId) {
  await getCustomer(tenantId, customerId);
  return repo.listPreferences(tenantId, customerId);
}

async function linkParticipant(tenantId, customerId, participantId, req) {
  await getCustomer(tenantId, customerId);
  const ok = await repo.linkParticipant(tenantId, participantId, customerId);
  if (!ok) throw new NotFoundError('Ese participante de mesa no existe.');
  await writeAudit({ req, tenantId, entityType: 'customer', entityId: customerId, action: 'link_participant', after: { participantId } });
  return { linked: true };
}

async function listOrders(tenantId, customerId) {
  await getCustomer(tenantId, customerId);
  return repo.listOrdersForCustomer(tenantId, customerId);
}

module.exports = {
  createCustomer, updateCustomer, getCustomer, listCustomers,
  setPreference, listPreferences, linkParticipant, listOrders,
};
