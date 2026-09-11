// Aislamiento entre empresas para CRM — dos empresas con un cliente de
// IGUAL teléfono; A nunca ve/edita nada de B (y el UNIQUE es por tenant, no
// global: el mismo teléfono en dos empresas no choca). Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const crmSvc = require('../src/modules/crm/crm.service');

const TA = 998820;
const TB = 998821;
const SAME_PHONE = '1199990000';
let ctx = {};

before(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?), (?, ?, ?)', [TA, 'CRM A', 'crm-iso-a', TB, 'CRM B', 'crm-iso-b']);
  ctx.a = await crmSvc.createCustomer(TA, { name: 'Cliente de A', phone: SAME_PHONE }, {});
  ctx.b = await crmSvc.createCustomer(TB, { name: 'Cliente de B', phone: SAME_PHONE }, {});
});

after(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.end().catch(() => {});
});

test('el mismo teléfono en dos empresas distintas no choca contra el UNIQUE (es por tenant)', () => {
  assert.notEqual(ctx.a.id, ctx.b.id);
});

test('listCustomers(A) no trae al cliente de B (mismo teléfono)', async () => {
  const list = await crmSvc.listCustomers(TA, { search: SAME_PHONE });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, ctx.a.id);
});

test('getCustomer(A, <id de B>) -> no lo encuentra', async () => {
  await assert.rejects(() => crmSvc.getCustomer(TA, ctx.b.id));
});

test('updateCustomer(A, <id de B>) -> no lo encuentra (A no puede editar clientes de B)', async () => {
  await assert.rejects(() => crmSvc.updateCustomer(TA, ctx.b.id, { notes: 'intento cruzado' }, {}));
});
