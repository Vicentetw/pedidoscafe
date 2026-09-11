// Aislamiento entre empresas para fidelización — dos empresas, cada una con
// su propio cliente y su propia regla/nivel de mismo código; A nunca ve ni
// toca la cuenta/ledger de B. Sin Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const crmSvc = require('../src/modules/crm/crm.service');
const loyaltySvc = require('../src/modules/loyalty/loyalty.service');

const TA = 998720;
const TB = 998721;
let ctx = {};
const staff = {};

before(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?), (?, ?, ?)', [TA, 'Loy A', 'loy-iso-a', TB, 'Loy B', 'loy-iso-b']);
  ctx.custA = await crmSvc.createCustomer(TA, { name: 'Cliente A' }, {});
  ctx.custB = await crmSvc.createCustomer(TB, { name: 'Cliente B' }, {});
  await loyaltySvc.createTier(TA, { code: 'top', name: 'Top A', minPoints: 0, multiplier: 1 }, {});
  await loyaltySvc.createTier(TB, { code: 'top', name: 'Top B', minPoints: 0, multiplier: 1 }, {}); // mismo código, otro tenant
  await loyaltySvc.adjust(TA, ctx.custA.id, { points: 50, reason: 'seed A' }, staff);
  await loyaltySvc.adjust(TB, ctx.custB.id, { points: 500, reason: 'seed B' }, staff);
});

after(async () => {
  await resetTenant(TA);
  await resetTenant(TB);
  await db.end().catch(() => {});
});

test('el mismo código de nivel en dos empresas no choca (UNIQUE por tenant)', async () => {
  const tiersA = await loyaltySvc.listTiers(TA);
  const tiersB = await loyaltySvc.listTiers(TB);
  assert.equal(tiersA.length, 1);
  assert.equal(tiersB.length, 1);
  assert.notEqual(tiersA[0].id, tiersB[0].id);
});

test('getAccount(A, clienteA) nunca ve el balance de B', async () => {
  const accA = await loyaltySvc.getAccount(TA, ctx.custA.id);
  assert.equal(accA.points_balance, 50);
});

test('ajustar la cuenta de un cliente que es de OTRO tenant -> no lo encuentra', async () => {
  await assert.rejects(() => loyaltySvc.adjust(TA, ctx.custB.id, { points: 10, reason: 'cruzado' }, staff));
});

test('listTransactions(A, clienteA) no ve nada del ledger de B', async () => {
  const txnsA = await loyaltySvc.listTransactions(TA, ctx.custA.id);
  assert.equal(txnsA.length, 1);
  assert.equal(txnsA[0].points, 50);
});
