// "Comprobante" por defecto mientras no haya CUIT + certificado real de
// AFIP cargados (INSTRUCCIONES.md §3.2: arrancar con ticket no fiscal para
// no bloquear el desarrollo). No tiene CAE ni valor fiscal — es un
// comprobante interno, numerado y trazable, que el sistema emite siempre
// que se le pida un comprobante y no haya AFIP configurado.
async function issue({ tenantId, branchId, posNo, repo, conn }) {
  const number = await repo.nextNumber(tenantId, branchId, posNo, 'TICKET', conn);
  return { docType: 'TICKET', posNo, number, cae: null, caeExpiresAt: null, status: 'ISSUED' };
}

module.exports = { issue, PROVIDER: 'TICKET_NO_FISCAL' };
