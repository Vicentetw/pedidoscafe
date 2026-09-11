// Adapter de efectivo — liquida en el momento, sin proveedor externo ni
// webhook. Lo carga un cajero/encargado desde el mostrador o la mesa.
async function createCheckout() {
  return { providerRef: null, initPoint: null, immediate: true };
}
module.exports = { createCheckout, PROVIDER: 'CASH' };
