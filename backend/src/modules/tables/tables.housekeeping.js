const settingsRepo = require('../platform/settings.repository');

// Mantenimiento automático de mesas (falla 8, parte 2A). Diseño aprobado por
// el dueño el 2026-11-10 — ver docs/AGENT_HANDOFF.md:
//  1. Sin consumo, saldo 0, sin actividad `auto_release_minutes` → ABANDONED.
//  2. Saldada (con consumo), sin actividad `paid_autoclose_minutes` → CLOSED.
//     Nunca si cocina tiene algo pendiente o hay un pago en curso.
//  3. Con saldo: NUNCA se cierra sola. Sin actividad `stale_hours` → "colgada":
//     se marca en Mesas/Conciliación y un QR nuevo no entra a esa cuenta.
//  4. `day_close_hour` (hora local de la sucursal): pasada esa hora, lo que
//     no tuvo actividad desde entonces se trata como inactivo (1 y 2 sin
//     esperar los minutos; 3 se marca).
// Todo por sucursal con fallback a empresa y a estos defaults.

const DEFAULTS = {
  enabled: true,
  autoReleaseMinutes: 60,
  paidAutocloseMinutes: 30,
  staleHours: 3,
  dayCloseHour: 4,
};

async function getPolicy(tenantId, branchId, conn) {
  const all = await settingsRepo.getAll(tenantId, branchId, conn); // sucursal pisa empresa
  const num = (k, d) => (typeof all[k] === 'number' ? all[k] : d);
  return {
    enabled: typeof all['tables.housekeeping_enabled'] === 'boolean' ? all['tables.housekeeping_enabled'] : DEFAULTS.enabled,
    autoReleaseMinutes: num('tables.auto_release_minutes', DEFAULTS.autoReleaseMinutes),
    paidAutocloseMinutes: num('tables.paid_autoclose_minutes', DEFAULTS.paidAutocloseMinutes),
    staleHours: num('tables.stale_hours', DEFAULTS.staleHours),
    // null guardado = sin cierre del día; sin fila = default.
    dayCloseHour: all['tables.day_close_hour'] === null ? null : num('tables.day_close_hour', DEFAULTS.dayCloseHour),
  };
}

// Minutos transcurridos desde la última vez que fue `hour`:00 en `tz`.
// Infinity si no hay cierre del día. (Argentina no tiene horario de verano;
// en zonas con DST el error es de a lo sumo una hora el día del cambio.)
function minutesSinceDayClose(tz, hour, now = new Date()) {
  if (hour == null) return Infinity;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const h = Number(parts.hour) % 24; // algunos runtimes devuelven "24" a medianoche
  return ((h - hour + 24) % 24) * 60 + Number(parts.minute);
}

// ¿La última actividad fue antes del último cierre del día?
function inactiveSinceDayClose(idleMinutes, policy, tz, now) {
  return idleMinutes > minutesSinceDayClose(tz, policy.dayCloseHour, now);
}

function hasBalance(s) {
  return Number(s.paid_amount) !== Number(s.total_amount);
}

// "Colgada": tiene saldo y nadie la tocó en `staleHours` (o desde el cierre del día).
function isStale(s, idleMinutes, policy, tz, now = new Date()) {
  if (!hasBalance(s)) return false;
  return idleMinutes >= policy.staleHours * 60 || inactiveSinceDayClose(idleMinutes, policy, tz, now);
}

// Con la mesa YA lockeada y los hechos re-leídos: qué hacer. null = nada.
function decideAutoFinish(s, facts, policy, tz, now = new Date()) {
  if (!policy.enabled) return null;
  if (hasBalance(s)) return null;                  // regla 3: con saldo nunca
  if (facts.paymentsInFlight > 0) return null;     // un pago de MP en curso
  if (facts.kitchenPending > 0) return null;       // cocina todavía tiene algo
  const pastClose = inactiveSinceDayClose(facts.idleMinutes, policy, tz, now);
  if (facts.consumedOrders === 0) {
    if (facts.idleMinutes >= policy.autoReleaseMinutes || pastClose) return { kind: 'release' };
    return null;
  }
  if (facts.idleMinutes >= policy.paidAutocloseMinutes || pastClose) return { kind: 'paid' };
  return null;
}

module.exports = { DEFAULTS, getPolicy, minutesSinceDayClose, isStale, hasBalance, decideAutoFinish };
