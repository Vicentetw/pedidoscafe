const repo = require('./devices.repository');
const ordersRepo = require('../orders/orders.repository');
const branchRepo = require('../platform/branches.repository');
const buzzerProvider = require('./providers/buzzerRadio.provider');
const { withTransaction } = require('../../withTransaction');
const { publish } = require('../../http/sse');
const { writeAudit } = require('../../audit/audit');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');

async function createDevice(tenantId, input, req) {
  if (!(await branchRepo.findById(tenantId, input.branchId))) throw new ValidationError('Esa sucursal no existe.');
  const id = await repo.createDevice(tenantId, input);
  await writeAudit({ req, tenantId, branchId: input.branchId, entityType: 'device', entityId: id, action: 'create', after: input });
  return repo.findDevice(tenantId, id);
}
async function listDevices(tenantId, query) { return repo.listDevices(tenantId, query); }
async function setStatus(tenantId, id, status, req) {
  const device = await repo.findDevice(tenantId, id);
  if (!device) throw new NotFoundError('Ese dispositivo no existe.');
  await repo.setStatus(tenantId, id, status);
  await writeAudit({ req, tenantId, branchId: device.branch_id, entityType: 'device', entityId: id, action: 'set_status', after: { status } });
  return repo.findDevice(tenantId, id);
}

// Modo mostrador (prompt.txt §22): al pagar, se le entrega un dispositivo
// al cliente. Idempotente si se reintenta con el MISMO código sobre el
// MISMO pedido; si el dispositivo ya está en otro pedido, se rechaza con un
// mensaje claro (no se "roba" un buzzer que alguien más está esperando).
async function assignDevice(tenantId, orderId, deviceCode, actor) {
  const result = await withTransaction(async (conn) => {
    const order = await ordersRepo.lockOrder(tenantId, orderId, conn);
    if (!order) throw new NotFoundError('Ese pedido no existe.');

    const existing = await repo.findActiveAssignmentForOrder(tenantId, orderId, conn);
    if (existing && existing.code === deviceCode) return { device: existing, alreadyAssigned: true, branchId: order.branch_id };
    if (existing) throw new ConflictError('Este pedido ya tiene otro dispositivo asignado; liberalo primero.', { code: 'ORDER_ALREADY_HAS_DEVICE' });

    const device = await repo.lockByCode(tenantId, order.branch_id, deviceCode, conn);
    if (!device) throw new NotFoundError('No existe un dispositivo con ese código en esta sucursal.');
    if (device.status !== 'AVAILABLE') throw new ConflictError('Ese dispositivo ya está en uso.', { code: 'DEVICE_NOT_AVAILABLE' });

    await repo.createAssignment(tenantId, device.id, orderId, conn);
    await repo.setStatus(tenantId, device.id, 'ASSIGNED', conn);
    return { device: { id: device.id, code: deviceCode }, alreadyAssigned: false, branchId: order.branch_id };
  });
  if (!result.alreadyAssigned) {
    await writeAudit({ req: actor.req, tenantId, branchId: result.branchId, entityType: 'order', entityId: orderId, action: 'assign_device', after: { deviceCode } });
  }
  return { deviceCode, orderId };
}

async function releaseDevice(tenantId, orderId, actor) {
  const result = await withTransaction(async (conn) => {
    const order = await ordersRepo.lockOrder(tenantId, orderId, conn);
    if (!order) throw new NotFoundError('Ese pedido no existe.');
    const active = await repo.findActiveAssignmentForOrder(tenantId, orderId, conn);
    if (!active) throw new NotFoundError('Este pedido no tiene un dispositivo asignado.');
    await repo.releaseAssignment(tenantId, active.id, conn);
    await repo.setStatus(tenantId, active.device_id, 'AVAILABLE', conn);
    return { branchId: order.branch_id, deviceCode: active.code };
  });
  await writeAudit({ req: actor.req, tenantId, branchId: result.branchId, entityType: 'order', entityId: orderId, action: 'release_device', after: { deviceCode: result.deviceCode } });
  return { released: true };
}

// Se llama desde kitchen.service cuando un pedido pasa a READY (mismo
// disparador que consumir el stock reservado al entregar). Nunca tira: un
// fallo acá no puede frenar el flujo de cocina. Dos mecanismos, ninguno
// bloquea al otro — si el buzzer no está configurado, el aviso digital
// (SSE) sale igual.
async function notifyOrderReady(tenantId, orderId) {
  try {
    const order = await ordersRepo.findOrder(tenantId, orderId);
    if (!order) return;
    const assignment = await repo.findActiveAssignmentForOrder(tenantId, orderId);

    let devicePaged = false;
    if (assignment) {
      try {
        await buzzerProvider.page(assignment);
        devicePaged = true;
        await repo.createNotification(tenantId, {
          branchId: order.branch_id, targetKind: 'DEVICE', targetRef: assignment.code, channel: 'DEVICE',
          template: 'order_ready', payload: { orderId }, status: 'SENT',
        });
      } catch (err) {
        await repo.createNotification(tenantId, {
          branchId: order.branch_id, targetKind: 'DEVICE', targetRef: assignment.code, channel: 'DEVICE',
          template: 'order_ready', payload: { orderId, error: err.code ?? 'ERROR' }, status: 'FAILED',
        });
      }
    }

    // Aviso digital — siempre, tenga o no dispositivo físico.
    await repo.createNotification(tenantId, {
      branchId: order.branch_id, targetKind: 'GUEST', targetRef: order.public_id, channel: 'SSE',
      template: 'order_ready', payload: { orderId }, status: 'SENT',
    });
    publish({
      tenantId, branchId: order.branch_id, topic: 'order_tracking', event: 'order_ready',
      data: { orderPublicId: order.public_id, status: 'READY', deviceCode: assignment?.code ?? null, devicePaged },
    });
  } catch {
    // Un problema acá (ej. la tabla notifications no disponible) nunca
    // puede tumbar el avance de un ticket de cocina.
  }
}

module.exports = { createDevice, listDevices, setStatus, assignDevice, releaseDevice, notifyOrderReady };
