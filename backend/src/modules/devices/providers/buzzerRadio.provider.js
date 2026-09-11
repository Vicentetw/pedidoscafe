// Seam para el buzzer físico (prompt.txt §22-23: "no eliminar el
// dispositivo físico"). No hay una base de radio/RF conectada a este
// entorno de desarrollo, así que este provider NO finge un "page()"
// exitoso — tira un error claro y documenta acá lo que hace falta para
// integrarlo de verdad, mismo criterio que afip.provider.js (Fase 8) y
// mercadopago.provider.js con Point (Fase 6).
//
// Lo que existiría en una integración real (dos familias típicas):
//   1) Base RF/RS-232 en el local (ej. LRS/JTech/Buzzworks): un driver
//      serial o USB-HID que envía "page(deviceCode)" a la base, que
//      retransmite por radio al buzzer físico. Requiere el hardware
//      conectado a la máquina que corre el backend (o un pequeño agente
//      intermediario) — no hay forma de probarlo sin la base real.
//   2) Base con API cloud (algunos fabricantes exponen HTTP/MQTT): un
//      POST autenticado con las credenciales del local. Tampoco hay una
//      cuenta real disponible acá.
//
// `devices.service.notifyOrderReady` llama a esto pero NUNCA deja que un
// fallo acá bloquee el aviso digital (SSE) — el buzzer es un mecanismo
// ADEMÁS del digital, no en vez de.
const { DomainError } = require('../../../errors');

async function page(/* device */) {
  throw new DomainError(
    'No hay una base de buzzers física configurada en este entorno.',
    { status: 503, code: 'BUZZER_NOT_CONFIGURED' }
  );
}

module.exports = { page };
