const repo = require('./tables.repository');
const branchRepo = require('../platform/branches.repository');
const settingsRepo = require('../platform/settings.repository');
const { assertTransition, canTransition, TERMINAL } = require('./tableSession.stateMachine');
const housekeeping = require('./tables.housekeeping');
const { logger } = require('../../logger');
const { withTransaction } = require('../../withTransaction');
const { issueTableSessionToken } = require('../../auth/sessionToken');
const { enqueue } = require('../../events/outbox');
const { publish } = require('../../http/sse');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError, ForbiddenError, DomainError } = require('../../errors');

const actorOf = (req) => req?.appUser?.id ?? null;

// ============================================================ MESAS (staff)
async function listTables(tenantId, branchId) {
  return repo.listTables(tenantId, branchId || null);
}
async function getTable(tenantId, id) {
  const t = await repo.findTable(tenantId, id);
  if (!t) throw new NotFoundError('Esa mesa no existe.');
  return t;
}
async function createTable(tenantId, input, req) {
  if (!(await branchRepo.findById(tenantId, input.branchId))) {
    throw new ValidationError('Esa sucursal no existe en tu empresa.');
  }
  if (await repo.findTableByCode(tenantId, input.branchId, input.code)) {
    throw new ConflictError('Ya existe una mesa con ese código en esa sucursal.');
  }
  const { id, token } = await withTransaction(async (conn) => {
    const tableId = await repo.createTable(tenantId, input, actorOf(req), conn);
    const qr = await repo.createQrToken(tenantId, input.branchId, tableId, conn);
    return { id: tableId, token: qr };
  });
  await writeAudit({ req, tenantId, branchId: input.branchId, entityType: 'table', entityId: id, action: 'create', after: input });
  return { ...(await repo.findTable(tenantId, id)), qr_token: token };
}
async function updateTable(tenantId, id, patch, req) {
  const before = await repo.findTable(tenantId, id);
  if (!before) throw new NotFoundError('Esa mesa no existe.');
  await repo.updateTable(tenantId, id, patch, actorOf(req));
  const after = await repo.findTable(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'table', entityId: id, action: 'update', before, after });
  return after;
}
async function deleteTable(tenantId, id, req) {
  const before = await repo.findTable(tenantId, id);
  if (!before) throw new NotFoundError('Esa mesa no existe.');
  if (before.current_session_id) throw new ConflictError('La mesa tiene una sesión abierta. Cerrala antes de eliminarla.');
  await withTransaction(async (conn) => {
    await repo.revokeQrTokens(tenantId, id, conn);
    await repo.softDeleteTable(tenantId, id, conn);
  });
  await writeAudit({ req, tenantId, entityType: 'table', entityId: id, action: 'delete', before });
}
async function rotateQr(tenantId, tableId, req) {
  const table = await repo.findTable(tenantId, tableId);
  if (!table) throw new NotFoundError('Esa mesa no existe.');
  const token = await withTransaction((conn) => repo.rotateQrToken(tenantId, tableId, conn));
  await writeAudit({ req, tenantId, branchId: table.branch_id, entityType: 'qr_token', entityId: tableId, action: 'rotate' });
  return { tableId, qr_token: token };
}

// ============================================ SESIONES desde el salón (staff)
async function openSessionFromSalon(tenantId, { tableId, assignSelfAsWaiter }, req) {
  const table = await repo.findTable(tenantId, tableId);
  if (!table) throw new NotFoundError('Esa mesa no existe.');
  if (table.current_session_id) throw new ConflictError('Esa mesa ya tiene una sesión abierta.');

  const waiterId = assignSelfAsWaiter ? actorOf(req) : null;
  const session = await withTransaction(async (conn) => {
    await repo.lockTableRow(tenantId, tableId, conn);
    const existing = await repo.findActiveSessionByTable(tenantId, tableId, conn);
    if (existing) throw new ConflictError('Esa mesa ya tiene una sesión abierta.');
    const created = await repo.createSession(tenantId, { branchId: table.branch_id, tableId, openedByKind: 'staff', waiterUserId: waiterId }, conn);
    await repo.setTableStatus(tenantId, tableId, 'OCCUPIED', created.id, conn);
    await enqueue(conn, { tenantId, branchId: table.branch_id, type: 'TableSessionOpened', payload: { sessionId: created.id, tableId, by: 'staff' } });
    return created;
  });
  publish({ tenantId, branchId: table.branch_id, topic: 'tables', event: 'session_opened', data: { tableId, sessionPublicId: session.publicId } });
  await writeAudit({ req, tenantId, branchId: table.branch_id, entityType: 'table_session', entityId: session.id, action: 'open', after: { tableId } });
  return staffSessionView(tenantId, session.id);
}

async function listOpenSessions(tenantId, branchId) {
  const rows = await repo.listOpenSessions(tenantId, branchId || null);
  return attachStale(tenantId, rows);
}

// Agrega `idleMinutes` y `stale` ("mesa colgada", ver tables.housekeeping.js)
// a cada sesión. Campos nuevos: los que ya existían no cambian.
async function attachStale(tenantId, rows) {
  const policies = new Map();
  const tzs = new Map();
  const now = new Date();
  for (const r of rows) {
    if (!policies.has(r.branch_id)) {
      policies.set(r.branch_id, await housekeeping.getPolicy(tenantId, r.branch_id));
      tzs.set(r.branch_id, (await branchRepo.findById(tenantId, r.branch_id))?.timezone);
    }
    const idle = Number(r.idle_minutes ?? 0);
    r.idleMinutes = idle;
    r.stale = housekeeping.isStale(r, idle, policies.get(r.branch_id), tzs.get(r.branch_id), now);
    delete r.idle_minutes;
  }
  return rows;
}

// Mesas con saldo y sin actividad — para Conciliación.
async function listStaleSessions(tenantId, branchId) {
  return (await listOpenSessions(tenantId, branchId)).filter((s) => s.stale);
}

// "Reactivar": el mozo confirma que la mesa sigue ocupada. Deja de estar
// colgada y vuelve a aceptar gente nueva por QR.
async function reactivateSession(tenantId, sessionId, req) {
  const s = await repo.findSessionById(tenantId, sessionId);
  if (!s) throw new NotFoundError('Esa sesión no existe.');
  if (TERMINAL.has(s.status)) throw new ConflictError('Esa mesa ya está cerrada.');
  await repo.touchSession(tenantId, sessionId);
  await writeAudit({ req, tenantId, branchId: s.branch_id, entityType: 'table_session', entityId: sessionId, action: 'reactivate' });
  publish({ tenantId, branchId: s.branch_id, topic: 'tables', event: 'session_updated', data: { sessionId } });
  return staffSessionView(tenantId, sessionId);
}

// Cierre automático de UNA mesa (lo llama runHousekeeping). Todo se
// re-verifica con la fila lockeada: si algo cambió (entró un pedido, un
// pago), no se cierra. Devuelve 'released' | 'closed' | null.
async function autoFinishSession(tenantId, sessionId) {
  const done = await withTransaction(async (conn) => {
    const cur = await repo.lockSession(tenantId, sessionId, conn);
    if (!cur || TERMINAL.has(cur.status)) return null;
    const branch = await branchRepo.findById(tenantId, cur.branch_id, conn);
    const policy = await housekeeping.getPolicy(tenantId, cur.branch_id, conn);
    const facts = await repo.housekeepingFacts(tenantId, sessionId, conn);
    const decision = housekeeping.decideAutoFinish(cur, facts, policy, branch?.timezone);
    if (!decision) return null;
    let target = decision.kind === 'release' && canTransition(cur.status, 'ABANDONED') ? 'ABANDONED' : 'CLOSED';
    if (target === 'CLOSED' && cur.status !== 'PAID' && !canTransition(cur.status, 'CLOSED')) return null;
    const reason = decision.kind === 'release'
      ? `Automático: sin consumo y sin actividad (${facts.idleMinutes} min)`
      : `Automático: cuenta saldada y sin actividad (${facts.idleMinutes} min)`;
    await repo.setSessionStatus(tenantId, sessionId, target, { closeReason: reason, closed: true }, conn);
    await repo.setTableStatus(tenantId, cur.table_id, 'FREE', null, conn);
    await enqueue(conn, { tenantId, branchId: cur.branch_id, type: 'TableSessionClosed', payload: { sessionId, reason: target === 'ABANDONED' ? 'auto_released' : 'auto_closed' } });
    return { cur, target, reason };
  });
  if (!done) return null;
  await writeAudit({ req: null, tenantId, branchId: done.cur.branch_id, entityType: 'table_session', entityId: sessionId, action: done.target === 'ABANDONED' ? 'auto_release' : 'auto_close', before: { status: done.cur.status }, reason: done.reason });
  publish({ tenantId, branchId: done.cur.branch_id, topic: 'tables', event: 'session_closed', data: { sessionId, tableId: done.cur.table_id, auto: true } });
  return done.target === 'ABANDONED' ? 'released' : 'closed';
}

// Recorre las mesas abiertas sin saldo y cierra las que corresponda.
// Las mesas con saldo no se tocan (sólo se marcan al listarlas).
async function runHousekeeping() {
  const rows = await repo.listHousekeepingCandidates();
  const out = { released: 0, closed: 0 };
  for (const r of rows) {
    if (housekeeping.hasBalance(r)) continue;
    try {
      const res = await autoFinishSession(r.tenant_id, r.id);
      if (res) out[res] += 1;
    } catch (err) {
      logger.error('table_housekeeping_failed', { sessionId: r.id, message: err.message });
    }
  }
  return out;
}

async function staffSessionView(tenantId, sessionId) {
  const s = await repo.findSessionById(tenantId, sessionId);
  if (!s) throw new NotFoundError('Esa sesión no existe.');
  const participants = await repo.listParticipants(tenantId, sessionId);
  return { ...s, participants };
}

async function assignWaiter(tenantId, sessionId, waiterUserId, req) {
  const s = await repo.findSessionById(tenantId, sessionId);
  if (!s) throw new NotFoundError('Esa sesión no existe.');
  if (TERMINAL.has(s.status)) throw new ConflictError('Esa sesión ya está cerrada.');
  await repo.assignWaiter(tenantId, sessionId, waiterUserId);
  await writeAudit({ req, tenantId, branchId: s.branch_id, entityType: 'table_session', entityId: sessionId, action: 'assign_waiter', before: { waiter_user_id: s.waiter_user_id }, after: { waiter_user_id: waiterUserId } });
  publish({ tenantId, branchId: s.branch_id, topic: 'tables', event: 'session_updated', data: { sessionId, waiterUserId } });
  return staffSessionView(tenantId, sessionId);
}

async function closeSession(tenantId, sessionId, req) {
  // El saldo se valida con la fila lockeada: un pedido confirmándose en ese
  // mismo momento (submitOrder lockea la misma fila) o entra antes y se ve
  // acá como saldo, o espera y se encuentra con la mesa ya cerrada.
  const s = await withTransaction(async (conn) => {
    const cur = await repo.lockSession(tenantId, sessionId, conn);
    if (!cur) throw new NotFoundError('Esa sesión no existe.');
    if (TERMINAL.has(cur.status)) return null;
    if (Number(cur.paid_amount) !== Number(cur.total_amount)) {
      throw new DomainError('No se puede cerrar la mesa: queda un saldo pendiente. Usá "cierre forzado" si corresponde.', {
        status: 409, code: 'SESSION_HAS_BALANCE',
        details: { total: cur.total_amount, paid: cur.paid_amount },
      });
    }
    // La ruta operativa "normal" pasa por BILL_REQUESTED -> PAID -> CLOSED; en
    // la Fase 3 (sin pagos) se permite OPEN -> CLOSED si el total es 0.
    if (cur.status !== 'PAID') assertTransition(cur.status, 'CLOSED');
    await repo.setSessionStatus(tenantId, sessionId, 'CLOSED', { closed: true }, conn);
    await repo.setTableStatus(tenantId, cur.table_id, 'FREE', null, conn);
    await enqueue(conn, { tenantId, branchId: cur.branch_id, type: 'TableSessionClosed', payload: { sessionId, reason: 'closed' } });
    return cur;
  });
  if (!s) return staffSessionView(tenantId, sessionId);
  await writeAudit({ req, tenantId, branchId: s.branch_id, entityType: 'table_session', entityId: sessionId, action: 'close' });
  publish({ tenantId, branchId: s.branch_id, topic: 'tables', event: 'session_closed', data: { sessionId, tableId: s.table_id } });
  return staffSessionView(tenantId, sessionId);
}

async function forceCloseSession(tenantId, sessionId, reason, req) {
  const s = await repo.findSessionById(tenantId, sessionId);
  if (!s) throw new NotFoundError('Esa sesión no existe.');
  if (TERMINAL.has(s.status)) return staffSessionView(tenantId, sessionId);
  await withTransaction(async (conn) => {
    await repo.setSessionStatus(tenantId, sessionId, 'FORCE_CLOSED', { closeReason: reason || 'Cierre forzado', closed: true }, conn);
    await repo.setTableStatus(tenantId, s.table_id, 'FREE', null, conn);
    await enqueue(conn, { tenantId, branchId: s.branch_id, type: 'TableSessionClosed', payload: { sessionId, reason: 'force_closed' } });
  });
  await writeAudit({ req, tenantId, branchId: s.branch_id, entityType: 'table_session', entityId: sessionId, action: 'force_close', before: { status: s.status, paid: s.paid_amount, total: s.total_amount }, reason });
  publish({ tenantId, branchId: s.branch_id, topic: 'tables', event: 'session_closed', data: { sessionId, tableId: s.table_id, forced: true } });
  return staffSessionView(tenantId, sessionId);
}

// ==================================================== SUPERFICIE COMENSAL
function assertResolvable(row) {
  // Un solo mensaje para cualquier falla — no se le dice al atacante qué
  // parte del QR estaba mal (§26).
  if (
    !row ||
    row.status !== 'ACTIVE' ||
    row.table_deleted != null ||
    row.branch_status !== 'active' ||
    row.tenant_status !== 'active'
  ) {
    throw new NotFoundError('Este código no es válido. Pedile al personal un código actualizado.');
  }
}

async function resolveQr(token) {
  const row = await repo.resolveActiveToken(token);
  assertResolvable(row);
  const needsCaptcha = !!require('../../config').config.publicSurface.turnstileSecret;
  return {
    tenant: { slug: row.tenant_slug, name: row.tenant_name },
    branch: { code: row.branch_code, name: row.branch_name },
    table: { code: row.table_code, name: row.table_name },
    needsCaptcha,
  };
}

function publicSessionView(s) {
  return {
    id: s.public_id,
    status: s.status,
    orderMode: s.order_mode,
    total: s.total_amount,
    paid: s.paid_amount,
    currency: s.currency,
    openedAt: s.opened_at,
  };
}

// Escaneo del QR -> crea o recupera la sesión de esa mesa + suma participante.
async function startSession(token, input, req) {
  const row = await repo.resolveActiveToken(token);
  assertResolvable(row);
  const { tenant_id: tenantId, branch_id: branchId, table_id: tableId } = row;

  const displayName = (input.displayName || '').trim() || 'Invitado';

  const result = await withTransaction(async (conn) => {
    // Lock pesimista de la fila de la mesa: dos escaneos simultáneos del
    // mismo QR quedan serializados. El 2º entra cuando el 1º ya commiteó
    // y ve su sesión (ARQUITECTURA_V1 §8/§12).
    await repo.lockTableRow(tenantId, tableId, conn);
    let session = await repo.findActiveSessionByTable(tenantId, tableId, conn);
    let isNew = false;
    if (!session) {
      const created = await repo.createSession(tenantId, { branchId, tableId, openedByKind: 'guest' }, conn);
      session = await repo.findSessionById(tenantId, created.id, conn);
      isNew = true;
    }
    if (TERMINAL.has(session.status)) {
      throw new ConflictError('Esta mesa se cerró recién. Volvé a escanear el código.');
    }
    // Mesa "colgada" (saldo sin cobrar y sin actividad): alguien nuevo no
    // entra a la cuenta vieja — antes el próximo cliente veía (y podía
    // pagar) lo del grupo anterior. El mozo la cobra, la cierra o la
    // reactiva si la mesa sigue ocupada.
    if (!isNew) {
      const policy = await housekeeping.getPolicy(tenantId, branchId, conn);
      const idle = await repo.sessionIdleMinutes(tenantId, session.id, conn);
      const branch = await branchRepo.findById(tenantId, branchId, conn);
      if (housekeeping.isStale(session, idle, policy, branch?.timezone)) {
        throw new ConflictError('Esta mesa quedó con una cuenta anterior sin cerrar. Llamá al mozo para que la revise.', { code: 'SESSION_STALE' });
      }
    }

    // Nombre repetido en la misma mesa: no sumar un duplicado silencioso
    // (bug real reportado — "Vicente"/"Vicente"/"Vicente" cargando pedidos
    // por separado, ilegible para el mozo). Si la persona ya confirmó
    // "soy yo" (`claim: true`), reusa ese participante existente en vez de
    // crear uno nuevo — mismo criterio de confianza que ya tiene el QR
    // compartido (cualquiera con el link puede anotar cualquier nombre).
    const existing = await repo.findActiveParticipantByName(tenantId, session.id, displayName, conn);
    if (existing && !input.claim) {
      throw new ConflictError(`Ya hay alguien anotado como "${displayName}" en esta mesa.`, {
        code: 'NAME_TAKEN', details: { displayName },
      });
    }
    const participant = existing && input.claim
      ? { id: existing.id, publicId: existing.public_id }
      : await repo.addParticipant(tenantId, session.id, {
          displayName,
          nickname: input.nickname ?? null,
          seatNo: input.seatNo ?? null,
        }, conn);

    if (isNew) {
      await repo.setTableStatus(tenantId, tableId, 'OCCUPIED', session.id, conn);
      await enqueue(conn, { tenantId, branchId, type: 'TableSessionOpened', payload: { sessionId: session.id, tableId, by: 'guest' } });
    }
    await repo.touchSession(tenantId, session.id, conn);
    await enqueue(conn, {
      tenantId, branchId, type: 'SessionParticipantJoined',
      payload: { sessionId: session.id, participantId: participant.id, displayName },
    });
    return { session, participant, isNew };
  });

  const participants = await repo.listParticipants(tenantId, result.session.id);
  publish({
    tenantId, branchId, topic: 'session',
    event: 'participant_joined',
    data: { sessionId: result.session.public_id, participantCount: participants.filter((p) => !p.left_at).length, displayName },
  });

  const jwt = issueTableSessionToken({
    sessionId: result.session.id,
    sessionPublicId: result.session.public_id,
    tenantId,
    branchId,
    tableId,
    participantId: result.participant.id,
  });

  return {
    token: jwt,
    session: publicSessionView(result.session),
    participant: { id: result.participant.publicId, displayName },
    table: { code: row.table_code, name: row.table_name },
    branch: { code: row.branch_code, name: row.branch_name },
    othersPresent: participants.filter((p) => !p.left_at && p.id !== result.participant.id).length,
  };
}

// Oculto por defecto (Fase post-roadmap, pedido en la aceptación): sin fila
// de config (o en false), la mesa sólo ofrece un pedido único. El dueño la
// prende por sucursal (o para toda la empresa dejando branchId null) desde
// Configuración.
async function allowsIndividualPayment(tenantId, branchId) {
  return (await settingsRepo.get(tenantId, 'orders.allow_individual_payment', branchId)) === true;
}

// ---- endpoints con table_session_token (req.tableSession) ----
async function getGuestSession(scope) {
  const s = await repo.findSessionById(scope.tenantId, scope.sessionId);
  if (!s) throw new NotFoundError('Tu sesión de mesa ya no existe.');
  // Bug real reportado: force-close en el panel de staff dejaba la mesa
  // "libre" ahí, pero el comensal que refrescaba seguía viendo la sesión
  // vieja tal cual (esta función nunca miraba el status) — el token seguía
  // siendo válido, así que no había forma de que se enterara. Con esto, el
  // refresh() del frontend recibe un error claro y limpia el token guardado
  // (mismo camino que un 401/404: ver core/table-session.ts).
  if (TERMINAL.has(s.status)) {
    throw new ConflictError('Esta mesa ya se cerró. Si volviste a la mesa, escaneá el código de nuevo.', { code: 'SESSION_CLOSED' });
  }
  const participants = await repo.listParticipants(scope.tenantId, scope.sessionId);
  return {
    session: publicSessionView(s),
    you: scope.participantId,
    allowIndividualPayment: await allowsIndividualPayment(scope.tenantId, scope.branchId),
    participants: participants
      .filter((p) => !p.left_at)
      .map((p) => ({
        id: p.public_id,
        name: p.nickname || p.display_name,
        isYou: p.id === scope.participantId,
        seatNo: p.seat_no,
      })),
  };
}

async function addGuestParticipant(scope, input) {
  const s = await repo.findSessionById(scope.tenantId, scope.sessionId);
  if (!s || TERMINAL.has(s.status)) throw new ConflictError('La sesión de la mesa ya está cerrada.');
  const p = await repo.addParticipant(scope.tenantId, scope.sessionId, {
    displayName: input.displayName.trim(),
    nickname: input.nickname ?? null,
    seatNo: input.seatNo ?? null,
  });
  await repo.touchSession(scope.tenantId, scope.sessionId);
  const participants = await repo.listParticipants(scope.tenantId, scope.sessionId);
  publish({
    tenantId: scope.tenantId, branchId: scope.branchId, topic: 'session',
    event: 'participant_joined',
    data: { sessionId: s.public_id, participantCount: participants.filter((x) => !x.left_at).length, displayName: input.displayName },
  });
  return { id: p.publicId, name: input.nickname || input.displayName };
}

// Sacar a alguien de la mesa (agregado de más por error, se fue, etc.) —
// cualquiera de los presentes lo puede hacer, no hay "admin" entre
// comensales. Baja lógica: sus pedidos ya cargados quedan intactos.
async function removeGuestParticipant(scope, participantPublicId) {
  const s = await repo.findSessionById(scope.tenantId, scope.sessionId);
  if (!s) throw new NotFoundError('Tu sesión de mesa ya no existe.');
  const p = await repo.findParticipantByPublicId(scope.tenantId, scope.sessionId, participantPublicId);
  if (!p) throw new NotFoundError('Ese participante no existe.');
  // Nadie se saca a sí mismo: tu propio table_session_token sigue firmado y
  // válido igual (no se revoca al "quitarte"), así que quedarías actuando
  // como un "fantasma" — tu nombre desaparece de la lista y tu pedido pasa
  // a verse como "Invitado" para el mozo/admin, aunque vos sigas pudiendo
  // pedir desde tu celular sin problema. Si te querés ir de la mesa,
  // simplemente cerrá la página — tu token vence solo.
  if (p.id === scope.participantId) {
    throw new ConflictError('No podés quitarte a vos mismo de la mesa. "Quitar" es para sacar a otra persona.');
  }
  const removed = await repo.removeParticipant(scope.tenantId, scope.sessionId, p.id);
  if (removed) {
    await repo.touchSession(scope.tenantId, scope.sessionId);
    const participants = await repo.listParticipants(scope.tenantId, scope.sessionId);
    publish({
      tenantId: scope.tenantId, branchId: scope.branchId, topic: 'session',
      event: 'participant_left',
      data: { sessionId: s.public_id, participantCount: participants.filter((x) => !x.left_at).length },
    });
  }
  return { removed };
}

async function setOrderMode(scope, mode) {
  const s = await repo.findSessionById(scope.tenantId, scope.sessionId);
  if (!s) throw new NotFoundError('Tu sesión de mesa ya no existe.');
  if (!['OPEN', 'ORDERING'].includes(s.status)) {
    throw new ConflictError('Ya no se puede cambiar el modo de pedido en esta mesa.');
  }
  // Server-side: nunca confiar en que el frontend haya ocultado el botón.
  if (mode === 'INDIVIDUAL' && !(await allowsIndividualPayment(scope.tenantId, scope.branchId))) {
    throw new ForbiddenError('Este local no tiene habilitado el pago individual por mesa.');
  }
  await require('../../db').query(
    `UPDATE table_sessions SET order_mode = :mode WHERE tenant_id = :tenantId AND id = :id`,
    { mode, tenantId: scope.tenantId, id: scope.sessionId }
  );
  publish({ tenantId: scope.tenantId, branchId: scope.branchId, topic: 'session', event: 'order_mode_changed', data: { sessionId: s.public_id, orderMode: mode } });
  return { orderMode: mode };
}

module.exports = {
  listTables, getTable, createTable, updateTable, deleteTable, rotateQr,
  openSessionFromSalon, listOpenSessions, listStaleSessions, reactivateSession, autoFinishSession, runHousekeeping,
  staffSessionView, assignWaiter, closeSession, forceCloseSession,
  resolveQr, startSession, getGuestSession, addGuestParticipant, removeGuestParticipant, setOrderMode,
  publicSessionView,
};
