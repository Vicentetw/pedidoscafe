// Aislamiento entre empresas para dispositivos — dos empresas con un
// buzzer de IGUAL código; A nunca ve ni puede asignar el de B. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const devicesSvc = require('../src/modules/devices/devices.service');
const orderSvc = require('../src/modules/orders/orders.service');

const TA = 998420;
const TB = 998421;
const SAME_CODE = 'B1';
let ctx = {};
const staff = { kind: 'staff', actorId: null, req: {} };

async function seed(tid, label) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Dev ${label}`, `dev-iso-${label.toLowerCase()}`]);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', 'Centro']);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [tid, c.insertId, 'x', 'X', '1000.00']);
  await devicesSvc.createDevice(tid, { branchId: b.insertId, code: SAME_CODE, kind: 'BUZZER' }, {});
  return { branchId: b.insertId };
}

before(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  ctx.a = await seed(TA, 'A');
  ctx.b = await seed(TB, 'B');
});

after(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.end().catch(() => {});
});

test('el mismo código de dispositivo en dos empresas no choca (UNIQUE por tenant+sucursal)', async () => {
  const listA = await devicesSvc.listDevices(TA, { branchId: ctx.a.branchId });
  const listB = await devicesSvc.listDevices(TB, { branchId: ctx.b.branchId });
  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.notEqual(listA[0].id, listB[0].id);
});

test('asignar el B1 de A a un pedido de A nunca toca el B1 de B (siguen AVAILABLE distintos)', async () => {
  const o = await orderSvc.createOrder(TA, { branchId: ctx.a.branchId, channel: 'COUNTER' }, staff);
  await orderSvc.addItem(TA, o.id, { productCode: 'x', qty: 1 }, staff);
  await devicesSvc.assignDevice(TA, o.id, SAME_CODE, staff);

  const [[devA]] = await db.query('SELECT status FROM devices WHERE tenant_id = ? AND code = ?', [TA, SAME_CODE]);
  const [[devB]] = await db.query('SELECT status FROM devices WHERE tenant_id = ? AND code = ?', [TB, SAME_CODE]);
  assert.equal(devA.status, 'ASSIGNED');
  assert.equal(devB.status, 'AVAILABLE', 'el B1 de B no se enteró de nada de A');
});
