// Dispositivos (buzzers) — alta, asignar/liberar en un pedido (modo
// mostrador, prompt.txt §22), y el aviso automático (buzzer + digital)
// cuando la cocina marca el pedido READY. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const devicesSvc = require('../src/modules/devices/devices.service');
const orderSvc = require('../src/modules/orders/orders.service');
const kitchenSvc = require('../src/modules/orders/kitchen.service');

const T = 998400;
let ctx = {};
const staff = { kind: 'staff', actorId: null, req: {} };

async function newOrderWithItem() {
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(T, o.id, { productCode: 'x', qty: 1 }, staff);
  return o.id;
}

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Devices', 'devices-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1000.00']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

test('registrar un dispositivo y listarlo por sucursal', async () => {
  const d = await devicesSvc.createDevice(T, { branchId: ctx.branchId, code: 'B1', kind: 'BUZZER' }, {});
  assert.equal(d.status, 'AVAILABLE');
  const list = await devicesSvc.listDevices(T, { branchId: ctx.branchId });
  assert.equal(list.length, 1);
});

test('asignar el dispositivo a un pedido lo deja ASSIGNED; reasignar el MISMO código es idempotente', async () => {
  const orderId = await newOrderWithItem();
  await devicesSvc.assignDevice(T, orderId, 'B1', staff);
  const [[d]] = await db.query('SELECT status FROM devices WHERE tenant_id = ? AND code = ?', [T, 'B1']);
  assert.equal(d.status, 'ASSIGNED');

  await devicesSvc.assignDevice(T, orderId, 'B1', staff); // no debe tirar ni duplicar la asignación
  const [rows] = await db.query('SELECT COUNT(*) n FROM device_assignments WHERE tenant_id = ? AND order_id = ? AND released_at IS NULL', [T, orderId]);
  assert.equal(rows[0].n, 1);
  ctx.orderWithDevice = orderId;
});

test('un pedido no puede tener DOS dispositivos: asignar otro código sin liberar antes se rechaza', async () => {
  await devicesSvc.createDevice(T, { branchId: ctx.branchId, code: 'B2', kind: 'BUZZER' }, {});
  await assert.rejects(() => devicesSvc.assignDevice(T, ctx.orderWithDevice, 'B2', staff), /otro dispositivo/);
});

test('un dispositivo ya asignado a OTRO pedido no se puede volver a entregar', async () => {
  const otherOrder = await newOrderWithItem();
  await assert.rejects(() => devicesSvc.assignDevice(T, otherOrder, 'B1', staff), /ya está en uso/);
});

test('un código de dispositivo inexistente da 404, no un error crudo', async () => {
  const orderId = await newOrderWithItem();
  await assert.rejects(() => devicesSvc.assignDevice(T, orderId, 'NO-EXISTE', staff), /No existe/);
});

test('liberar el dispositivo lo deja disponible para otro pedido', async () => {
  await devicesSvc.releaseDevice(T, ctx.orderWithDevice, staff);
  const [[d]] = await db.query('SELECT status FROM devices WHERE tenant_id = ? AND code = ?', [T, 'B1']);
  assert.equal(d.status, 'AVAILABLE');

  const otherOrder = await newOrderWithItem();
  await devicesSvc.assignDevice(T, otherOrder, 'B1', staff); // ahora sí funciona
  await devicesSvc.releaseDevice(T, otherOrder, staff); // deja limpio para el resto de los tests
});

test('al pasar un pedido a READY con buzzer asignado: aviso digital SENT + intento de buzzer FAILED (sin base física configurada)', async () => {
  const orderId = await newOrderWithItem();
  await devicesSvc.assignDevice(T, orderId, 'B1', staff);
  await orderSvc.submitOrder(T, orderId, staff);
  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, orderId]);

  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // QUEUED -> PREPARING
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // PREPARING -> READY -> dispara notifyOrderReady

  const [notifs] = await db.query(
    'SELECT target_kind, channel, status FROM notifications WHERE tenant_id = ? AND JSON_EXTRACT(payload, "$.orderId") = ? ORDER BY target_kind',
    [T, orderId]
  );
  assert.equal(notifs.length, 2);
  const device = notifs.find((n) => n.target_kind === 'DEVICE');
  const guest = notifs.find((n) => n.target_kind === 'GUEST');
  assert.equal(device.status, 'FAILED', 'no hay base de buzzers real en este entorno — se registra el intento fallido, no se finge éxito');
  assert.equal(guest.status, 'SENT', 'el aviso digital sí sale siempre');
  assert.equal(guest.channel, 'SSE');

  const [[d]] = await db.query('SELECT status FROM devices WHERE tenant_id = ? AND code = ?', [T, 'B1']);
  assert.equal(d.status, 'ASSIGNED', 'el dispositivo sigue asignado: se libera con una acción del staff, no solo');
  await devicesSvc.releaseDevice(T, orderId, staff);
});

test('un pedido SIN dispositivo también recibe el aviso digital al quedar READY', async () => {
  const orderId = await newOrderWithItem();
  await orderSvc.submitOrder(T, orderId, staff);
  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, orderId]);
  await kitchenSvc.advanceTicket(T, tk.id, {}, null);
  await kitchenSvc.advanceTicket(T, tk.id, {}, null);

  const [notifs] = await db.query('SELECT target_kind, status FROM notifications WHERE tenant_id = ? AND JSON_EXTRACT(payload, "$.orderId") = ?', [T, orderId]);
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].target_kind, 'GUEST');
  assert.equal(notifs[0].status, 'SENT');
});

test('avanzar el ticket una TERCERA vez (READY -> DELIVERED) no vuelve a avisar', async () => {
  const orderId = await newOrderWithItem();
  await orderSvc.submitOrder(T, orderId, staff);
  const [[tk]] = await db.query('SELECT id FROM kitchen_tickets WHERE tenant_id = ? AND order_id = ?', [T, orderId]);
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // -> PREPARING
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // -> READY (1er aviso)
  await kitchenSvc.advanceTicket(T, tk.id, {}, null); // -> DELIVERED (no debe avisar de nuevo)

  const [notifs] = await db.query('SELECT id FROM notifications WHERE tenant_id = ? AND JSON_EXTRACT(payload, "$.orderId") = ?', [T, orderId]);
  assert.equal(notifs.length, 1, 'sólo un aviso: el que corresponde a la transición A READY, no cada avance de ticket');
});
