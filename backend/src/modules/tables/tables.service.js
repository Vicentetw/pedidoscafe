const repo = require('./tables.repository');
const branchRepo = require('../platform/branches.repository');
const settingsRepo = require('../platform/settings.repository');
const { assertTransition, TERMINAL } = require('./tableSession.stateMachine');
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
  return repo.listOpenSessions(tenantId, branchId || null);
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
  const s = await repo.findSessionById(tenantId, sessionId);
  if (!s) throw new NotFoundError('Esa sesión no existe.');
  if (TERMINAL.has(s.status)) return staffSessionView(tenantId, sessionId);
  if (Number(s.paid_amount) !== Number(s.total_amount)) {
    throw new DomainError('No se puede cerrar la mesa: queda un saldo pendiente. Usá "cierre forzado" si corresponde.', {
      status: 409, code: 'SESSION_HAS_BALANCE',
      details: { total: s.total_amount, paid: s.paid_amount },
    });
  }
  // La ruta operativa "normal" pasa por BILL_REQUESTED -> PAID -> CLOSED; en
  // la Fase 3 (sin pagos) se permite OPEN -> CLOSED si el total es 0.
  await withTransaction(async (conn) => {
    if (s.status !== 'PAID') assertTransition(s.status, 'CLOSED');
    await repo.setSessionStatus(tenantId, sessionId, 'CLOSED', { closed: true }, conn);
    await repo.setTableStatus(tenantId, s.table_id, 'FREE', null, conn);
    await enqueue(conn, { tenantId, branchId: s.branch_id, type: 'TableSessionClosed', payload: { sessionId, reason: 'closed' } });
  });
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
    const participant = await repo.addParticipant(tenantId, session.id, {
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
  openSessionFromSalon, listOpenSessions, staffSessionView, assignWaiter, closeSession, forceCloseSession,
  resolveQr, startSession, getGuestSession, addGuestParticipant, removeGuestParticipant, setOrderMode,
  publicSessionView,
};
