const crypto = require('crypto');
const { ulid } = require('ulid');
const pool = require('../../db');

// Repo de mesas / QR / sesiones / participantes. tenantId primero; todo
// WHERE lo lleva (salvo la resolución de un qr_token, que ES la que
// descubre el tenant — pero devuelve la fila completa para que el service
// valide el resto server-side).

function newToken() {
  return crypto.randomBytes(32).toString('base64url'); // 43 chars, opaco
}

// -------------------------------------------------------------- mesas
async function listTables(tenantId, branchId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT t.id, t.tenant_id, t.branch_id, t.code, t.name, t.seats, t.zone, t.status, t.current_session_id,
            q.token AS qr_token
       FROM tables t
       LEFT JOIN qr_tokens q ON q.table_id = t.id AND q.status = 'ACTIVE'
      WHERE t.tenant_id = :tenantId ${branchId ? 'AND t.branch_id = :branchId' : ''} AND t.deleted_at IS NULL
      ORDER BY t.zone, t.code`,
    { tenantId, branchId }
  );
  return rows;
}
async function findTable(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, branch_id, code, name, seats, zone, status, current_session_id
       FROM tables WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return row || null;
}
// Toma un lock pesimista sobre la fila de la mesa (SELECT ... FOR UPDATE).
// Serializa los escaneos concurrentes del mismo QR: el 2º espera, y cuando
// entra ya ve la sesión que creó el 1º (ARQUITECTURA_V1 §8/§12). Debe
// correr DENTRO de una transacción.
async function lockTableRow(tenantId, tableId, conn) {
  const [[row]] = await conn.query(
    `SELECT id, branch_id, current_session_id FROM tables
      WHERE tenant_id = :tenantId AND id = :tableId AND deleted_at IS NULL
      FOR UPDATE`,
    { tenantId, tableId }
  );
  return row || null;
}

async function findTableByCode(tenantId, branchId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM tables WHERE tenant_id = :tenantId AND branch_id = :branchId AND code = :code AND deleted_at IS NULL`,
    { tenantId, branchId, code }
  );
  return row || null;
}
async function createTable(tenantId, d, actor, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO tables (tenant_id, branch_id, code, name, seats, zone, created_by, updated_by)
     VALUES (:tenantId, :branchId, :code, :name, :seats, :zone, :actor, :actor)`,
    { tenantId, branchId: d.branchId, code: d.code, name: d.name ?? null, seats: d.seats ?? 2, zone: d.zone ?? null, actor: actor ?? null }
  );
  return r.insertId;
}
async function updateTable(tenantId, id, patch, actor, conn = pool) {
  const f = ['updated_by = :actor'];
  const p = { tenantId, id, actor: actor ?? null };
  for (const [k, col] of Object.entries({ name: 'name', seats: 'seats', zone: 'zone', status: 'status' })) {
    if (patch[k] !== undefined) { f.push(`${col} = :${k}`); p[k] = patch[k]; }
  }
  await conn.query(`UPDATE tables SET ${f.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, p);
}
async function setTableStatus(tenantId, id, status, sessionId, conn = pool) {
  await conn.query(
    `UPDATE tables SET status = :status, current_session_id = :sessionId WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id, status, sessionId: sessionId ?? null }
  );
}
async function softDeleteTable(tenantId, id, conn = pool) {
  await conn.query(`UPDATE tables SET deleted_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`, { tenantId, id });
}

// ----------------------------------------------------------- qr_tokens
async function createQrToken(tenantId, branchId, tableId, conn = pool) {
  const token = newToken();
  await conn.query(
    `INSERT INTO qr_tokens (tenant_id, branch_id, table_id, token, status) VALUES (:tenantId, :branchId, :tableId, :token, 'ACTIVE')`,
    { tenantId, branchId, tableId, token }
  );
  return token;
}
async function rotateQrToken(tenantId, tableId, conn = pool) {
  const [[t]] = await conn.query(`SELECT id, branch_id FROM tables WHERE tenant_id = :tenantId AND id = :tableId AND deleted_at IS NULL`, { tenantId, tableId });
  if (!t) return null;
  await conn.query(
    `UPDATE qr_tokens SET status = 'ROTATED', rotated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = :tenantId AND table_id = :tableId AND status = 'ACTIVE'`,
    { tenantId, tableId }
  );
  return createQrToken(tenantId, t.branch_id, tableId, conn);
}
async function revokeQrTokens(tenantId, tableId, conn = pool) {
  await conn.query(
    `UPDATE qr_tokens SET status = 'REVOKED', rotated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = :tenantId AND table_id = :tableId AND status = 'ACTIVE'`,
    { tenantId, tableId }
  );
}
// Resuelve un token OPACO -> tenant/branch/table (server-side). Sólo ACTIVE.
async function resolveActiveToken(token, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT q.token, q.status, q.tenant_id, q.branch_id, q.table_id,
            t.code AS table_code, t.name AS table_name, t.deleted_at AS table_deleted,
            b.code AS branch_code, b.name AS branch_name, b.status AS branch_status,
            tn.slug AS tenant_slug, tn.name AS tenant_name, tn.status AS tenant_status
       FROM qr_tokens q
       JOIN tables t   ON t.id = q.table_id
       JOIN branches b ON b.id = q.branch_id
       JOIN tenants tn ON tn.id = q.tenant_id
      WHERE q.token = :token`,
    { token }
  );
  return row || null;
}

// ------------------------------------------------------- table_sessions
const SESSION_COLS = `id, public_id, tenant_id, branch_id, table_id, status, order_mode,
  total_amount, paid_amount, currency, waiter_user_id, opened_by_kind, opened_at, closed_at`;

async function findActiveSessionByTable(tenantId, tableId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT ${SESSION_COLS} FROM table_sessions
      WHERE tenant_id = :tenantId AND active_table_id = :tableId`,
    { tenantId, tableId }
  );
  return row || null;
}
async function findSessionById(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT ${SESSION_COLS} FROM table_sessions WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id }
  );
  return row || null;
}
// Lock pesimista sobre la sesión — lo usa payments.service al aplicar un
// pago, para que dos pagos concurrentes sobre la misma mesa se serialicen
// (ARQUITECTURA_V1 §10-12, caso obligatorio 2).
async function lockSession(tenantId, id, conn) {
  const [[row]] = await conn.query(
    `SELECT ${SESSION_COLS} FROM table_sessions WHERE tenant_id = :tenantId AND id = :id FOR UPDATE`,
    { tenantId, id }
  );
  return row || null;
}
async function setSessionAmounts(tenantId, id, paidAmount, conn = pool) {
  await conn.query(`UPDATE table_sessions SET paid_amount = :paidAmount WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, paidAmount });
}
async function findSessionByPublicId(publicId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT ${SESSION_COLS} FROM table_sessions WHERE public_id = :publicId`,
    { publicId }
  );
  return row || null;
}
async function createSession(tenantId, { branchId, tableId, openedByKind, waiterUserId = null }, conn = pool) {
  const publicId = ulid();
  // GROUP por defecto (un solo pedido/cuenta para la mesa) — es lo que
  // espera la mayoría de los comercios, y no exige que cada persona entre
  // con su propio celular. INDIVIDUAL ("cada uno lo suyo") sigue
  // disponible, lo elige el comensal desde la mesa (PUT /session/order-mode).
  const [r] = await conn.query(
    `INSERT INTO table_sessions (public_id, tenant_id, branch_id, table_id, status, order_mode, opened_by_kind, waiter_user_id)
     VALUES (:publicId, :tenantId, :branchId, :tableId, 'OPEN', 'GROUP', :openedByKind, :waiterUserId)`,
    { publicId, tenantId, branchId, tableId, openedByKind, waiterUserId }
  );
  return { id: r.insertId, publicId };
}
async function setSessionStatus(tenantId, id, status, { closeReason = null, closed = false } = {}, conn = pool) {
  await conn.query(
    `UPDATE table_sessions
        SET status = :status,
            close_reason = COALESCE(:closeReason, close_reason),
            closed_at = CASE WHEN :closed = 1 THEN CURRENT_TIMESTAMP ELSE closed_at END
      WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id, status, closeReason, closed: closed ? 1 : 0 }
  );
}
async function assignWaiter(tenantId, id, waiterUserId, conn = pool) {
  await conn.query(`UPDATE table_sessions SET waiter_user_id = :waiterUserId WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id, waiterUserId });
}
async function touchSession(tenantId, id, conn = pool) {
  await conn.query(`UPDATE table_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id`, { tenantId, id });
}
async function listOpenSessions(tenantId, branchId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT s.id, s.public_id, s.tenant_id, s.branch_id, s.table_id, s.status, s.order_mode,
            s.total_amount, s.paid_amount, s.currency, s.waiter_user_id, s.opened_at,
            t.code AS table_code,
            (SELECT COUNT(*) FROM session_participants p WHERE p.session_id = s.id AND p.left_at IS NULL) AS participant_count
       FROM table_sessions s JOIN tables t ON t.id = s.table_id
      WHERE s.tenant_id = :tenantId ${branchId ? 'AND s.branch_id = :branchId' : ''}
        AND s.status IN ('OPEN','ORDERING','SERVING','BILL_REQUESTED','PARTIALLY_PAID','PAID')
      ORDER BY s.opened_at DESC`,
    { tenantId, branchId }
  );
  return rows;
}

// -------------------------------------------------- session_participants
async function addParticipant(tenantId, sessionId, { displayName, nickname = null, seatNo = null }, conn = pool) {
  const publicId = ulid();
  const [r] = await conn.query(
    `INSERT INTO session_participants (public_id, tenant_id, session_id, display_name, nickname, seat_no, kind)
     VALUES (:publicId, :tenantId, :sessionId, :displayName, :nickname, :seatNo, 'GUEST')`,
    { publicId, tenantId, sessionId, displayName, nickname, seatNo }
  );
  return { id: r.insertId, publicId };
}
// Para el aviso de "ya hay alguien anotado con ese nombre" (evita
// duplicados como "Vicente"/"Vicente"/"vicente " en la misma mesa) —
// comparación case/espacios-insensible, sólo entre participantes activos
// (uno que ya se fue no "ocupa" el nombre).
async function findActiveParticipantByName(tenantId, sessionId, displayName, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, public_id, display_name FROM session_participants
      WHERE tenant_id = :tenantId AND session_id = :sessionId AND left_at IS NULL
        AND LOWER(TRIM(display_name)) = LOWER(TRIM(:displayName))
      LIMIT 1`,
    { tenantId, sessionId, displayName }
  );
  return row || null;
}
async function listParticipants(tenantId, sessionId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, public_id, display_name, nickname, seat_no, kind, joined_at, left_at
       FROM session_participants
      WHERE tenant_id = :tenantId AND session_id = :sessionId
      ORDER BY joined_at`,
    { tenantId, sessionId }
  );
  return rows;
}
async function findParticipant(tenantId, sessionId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, public_id, display_name, nickname, seat_no, session_id
       FROM session_participants WHERE tenant_id = :tenantId AND session_id = :sessionId AND id = :id`,
    { tenantId, sessionId, id }
  );
  return row || null;
}
async function findParticipantByPublicId(tenantId, sessionId, publicId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, public_id, display_name, nickname, seat_no, session_id
       FROM session_participants WHERE tenant_id = :tenantId AND session_id = :sessionId AND public_id = :publicId`,
    { tenantId, sessionId, publicId }
  );
  return row || null;
}
// Baja lógica (left_at) — la fila y sus pedidos quedan intactos, sólo deja
// de listarse como alguien presente en la mesa. Idempotente: si ya se había
// ido, no vuelve a tocar la fila.
async function removeParticipant(tenantId, sessionId, id, conn = pool) {
  const [r] = await conn.query(
    `UPDATE session_participants SET left_at = NOW()
      WHERE tenant_id = :tenantId AND session_id = :sessionId AND id = :id AND left_at IS NULL`,
    { tenantId, sessionId, id }
  );
  return r.affectedRows > 0;
}

module.exports = {
  newToken, lockTableRow,
  listTables, findTable, findTableByCode, createTable, updateTable, setTableStatus, softDeleteTable,
  createQrToken, rotateQrToken, revokeQrTokens, resolveActiveToken,
  findActiveSessionByTable, findSessionById, lockSession, setSessionAmounts, findSessionByPublicId, createSession, setSessionStatus,
  assignWaiter, touchSession, listOpenSessions,
  addParticipant, listParticipants, findParticipant, findParticipantByPublicId, removeParticipant,
  findActiveParticipantByName,
};
