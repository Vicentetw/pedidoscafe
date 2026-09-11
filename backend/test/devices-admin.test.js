// Gating de permisos de dispositivos por HTTP con ID token real de Firebase
// + seguimiento público de un pedido (sin login, prompt.txt §22). mozo NO
// tiene devices:view/manage/assign (permiso nuevo de esta fase, sembrado
// sólo para owner/admin*/encargado/cajero); cajero sí puede asignar pero no
// registrar dispositivos nuevos.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 998410;
const UID_CAJA = 'test-devices-cajero';
const UID_MOZO = 'test-devices-mozo';
let srv;
let cajaH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Devices admin', 'devices-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'x', 'X', '1000.00']);
  cajaH = await getTestAuthHeaders(UID_CAJA, { isSuperadmin: false, tenantId: T, roleCodes: ['cajero'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_CAJA).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (m, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: m, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('el mozo no puede ver dispositivos; el cajero puede asignar pero no registrar (le falta devices:manage)', { skip: SKIP }, async () => {
  const blockedList = await req('GET', `/api/devices?branchId=${ctx.branchId}`, mozoH);
  assert.equal(blockedList.status, 403);

  const blockedCreate = await req('POST', '/api/devices', cajaH, { branchId: ctx.branchId, code: 'B1', kind: 'BUZZER' });
  assert.equal(blockedCreate.status, 403, 'cajero tiene devices:assign pero no devices:manage');
});

test('el cajero puede asignar un dispositivo (ya registrado) a un pedido por HTTP; el mozo no', { skip: SKIP }, async () => {
  // El alta del dispositivo en sí exige devices:manage (nadie en este test lo
  // tiene) — se registra directo por service, como haría un owner/admin.
  const devicesSvc = require('../src/modules/devices/devices.service');
  await devicesSvc.createDevice(T, { branchId: ctx.branchId, code: 'B1', kind: 'BUZZER' }, {});

  const orderRes = await req('POST', '/api/orders', cajaH, { branchId: ctx.branchId, channel: 'COUNTER' });
  const order = await orderRes.json();
  await req('POST', `/api/orders/${order.id}/items`, cajaH, { productCode: 'x', qty: 1 });

  const blocked = await req('POST', `/api/orders/${order.id}/device`, mozoH, { deviceCode: 'B1' });
  assert.equal(blocked.status, 403);

  const assigned = await req('POST', `/api/orders/${order.id}/device`, cajaH, { deviceCode: 'B1' });
  assert.equal(assigned.status, 201);
  ctx.orderPublicId = order.public_id;
});

test('seguimiento público del pedido: status y stream no piden login', { skip: SKIP }, async () => {
  const status = await req('GET', `/api/public/orders/${ctx.orderPublicId}/status`, {});
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(body.deviceCode, 'B1');
  assert.equal(body.branchName, 'Centro');

  const bogus = await req('GET', `/api/public/orders/no-existe-123/status`, {});
  assert.equal(bogus.status, 404);
});
