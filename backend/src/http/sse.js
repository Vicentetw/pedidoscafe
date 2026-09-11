// Hub de Server-Sent Events. El backend empuja a las conexiones filtrando
// por tenant/branch y por topic (orders, kitchen, stock, session, menu).
// Alcanza para lo que la arquitectura v1 necesita en tiempo real (todo
// server→cliente). WebSocket recién si aparece algo bidireccional.
//
// Aislado a propósito en un solo archivo: si a futuro esto escala mal
// (miles de conexiones), se reemplaza por WS + Redis pub/sub sin tocar
// los services — que solo llaman a publish().
const { logger } = require('../logger');

/** @type {Set<{ res: import('http').ServerResponse, tenantId: number, branchId: number|null, topics: Set<string>, sessionPublicId?: string, orderPublicId?: string }>} */
const clients = new Set();

function handleStream(req, res) {
  // Scope obligatorio: un staff sólo escucha su tenant (y opcionalmente su
  // branch). El comensal escuchará su sesión (se suma en la Fase 3).
  const tenantId = req.appUser?.tenantId ?? null;
  if (tenantId == null && !req.appUser?.isSuperadmin) {
    return res.status(401).json({ error: 'Necesitás iniciar sesión.', code: 'UNAUTHORIZED' });
  }
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const topics = new Set(
    String(req.query.topics || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const client = { res, tenantId, branchId, topics };
  clients.add(client);
  req.log?.info('sse_connect', { tenantId, branchId, topics: [...topics], total: clients.size });

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
}

// Conexión SSE de un COMENSAL — acotada a su sesión de mesa. El scope sale
// del table_session_token (req.tableSession), nunca de la query.
function handleGuestStream(req, res) {
  const ts = req.tableSession;
  if (!ts) return res.status(401).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = {
    res,
    tenantId: ts.tenantId,
    branchId: ts.branchId,
    topics: new Set(['session']),
    sessionPublicId: ts.sessionPublicId,
  };
  clients.add(client);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
}

// Conexión SSE de seguimiento de UN pedido — sin login (Fase 13, modo
// mostrador). El scope sale del public_id del pedido, resuelto por la ruta
// pública ANTES de llegar acá (req.orderTracking), nunca de la query.
function handleOrderTrackingStream(req, res) {
  const t = req.orderTracking;
  if (!t) return res.status(401).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client = { res, tenantId: t.tenantId, branchId: null, topics: new Set(['order_tracking']), orderPublicId: t.orderPublicId };
  clients.add(client);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(client);
  });
}

/**
 * Empuja un evento a las conexiones que correspondan.
 * @param {{ tenantId: number, branchId?: number|null, topic: string, event: string, data: any }} msg
 */
function publish({ tenantId, branchId = null, topic, event, data }) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const c of clients) {
    if (c.tenantId !== tenantId) continue;
    if (c.branchId != null && branchId != null && c.branchId !== branchId) continue;
    if (c.topics.size && !c.topics.has(topic)) continue;
    // Un comensal sólo recibe eventos de SU sesión.
    if (c.sessionPublicId && (topic !== 'session' || data?.sessionId !== c.sessionPublicId)) continue;
    // Igual, pero para el seguimiento público de UN pedido (Fase 13).
    if (c.orderPublicId && (topic !== 'order_tracking' || data?.orderPublicId !== c.orderPublicId)) continue;
    try {
      c.res.write(payload);
      sent++;
    } catch {
      clients.delete(c);
    }
  }
  return sent;
}

function connectionCount() {
  return clients.size;
}

// Cierra todo (tests / shutdown ordenado).
function closeAll() {
  for (const c of clients) {
    try {
      c.res.end();
    } catch {
      /* noop */
    }
  }
  clients.clear();
  logger.info('sse_closed_all');
}

module.exports = { handleStream, handleGuestStream, handleOrderTrackingStream, publish, connectionCount, closeAll };
