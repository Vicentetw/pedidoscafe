const cashSvc = require('../../src/modules/cash/cash.service');

// Desde la falla 4 un cobro en efectivo exige una caja abierta en la
// sucursal. Los tests que cobran en efectivo abren una al crear la sucursal.
async function openCash(tenantId, branchId) {
  const register = await cashSvc.createRegister(tenantId, branchId, { code: 'test', name: 'Caja de test' }, {});
  return cashSvc.openRegister(tenantId, register.id, '0.00', {});
}

module.exports = { openCash };
