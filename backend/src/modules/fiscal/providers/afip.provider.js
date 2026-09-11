// Adapter AFIP/ARCA real (WSAA + WSFEv1) — NO IMPLEMENTADO TODAVÍA A
// PROPÓSITO. No hay CUIT ni certificado digital reales disponibles en este
// entorno (WSAA exige un certificado .crt/.key emitido por AFIP a un CUIT
// productivo o de homologación real; no hay forma de fabricar uno ni de
// probar el intercambio SOAP sin él). Escribir la integración sin poder
// verificarla contra el WSDL real de AFIP sería peor que no escribirla —
// quedaría código fiscal sin probar, exactamente lo que
// ARQUITECTURA_V1 §21 marca como riesgo alto.
//
// Lo que falta para completar esto (documentado, no implementado):
//   1. WSAA (Web Service de Autenticación y Autorización):
//      - armar un "Login Ticket Request" (XML con <uniqueId>, <generationTime>,
//        <expirationTime>, <service>wsfe</service>),
//      - firmarlo como CMS/PKCS#7 (openssl smime -sign) con el certificado
//        y la clave privada del contribuyente,
//      - POST del CMS en base64 al endpoint de WSAA (homologación:
//        wsaahomo.afip.gov.ar; producción: wsaa.afip.gov.ar),
//      - la respuesta trae <token> y <sign>, válidos ~12hs -- se guardan en
//        `afip_tokens` (ya existe la tabla) y se reusan hasta expirar.
//   2. WSFEv1 (Web Service de Facturación Electrónica):
//      - SOAP con el token/sign de WSAA + el CUIT,
//      - `FECompUltimoAutorizado` para saber el próximo número,
//      - `FECAESolicitar` con los datos del comprobante (tipo, punto de
//        venta, importes netos/IVA, doc del receptor) -- devuelve el CAE y
//        su vencimiento, o un rechazo con el motivo.
//   3. Probar TODO contra el ambiente de HOMOLOGACIÓN primero (requiere un
//      CUIT de prueba dado de alta en el portal de AFIP), recién después
//      producción.
//
// Mientras tanto, `fiscal.service.js` usa `ticketNoFiscal.provider.js`.
const { DomainError } = require('../../../errors');

function notConfigured() {
  throw new DomainError(
    'La facturación electrónica con AFIP todavía no está configurada. Se emite un ticket no fiscal.',
    { status: 503, code: 'AFIP_NOT_CONFIGURED' }
  );
}

async function authenticate() {
  notConfigured();
}
async function requestCAE() {
  notConfigured();
}

module.exports = { authenticate, requestCAE, PROVIDER: 'AFIP_WSFEv1' };
