// Back-office de stock por HTTP con ID token real de Firebase. Gating:
// stock / compras / recetas necesitan permisos de inventory; el mozo no.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 999740;
const UID_STOCK = 'test-stk-stock';
const UID_MOZO = 'test-stk-mozo';
let srv;
let stockH;
let mozoH;
let ctx = {};

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Stock admin', 'stock-admin-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  const [p] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [T, c.insertId, 'latte', 'Latte', '4500.00']);
  ctx.productId = p.insertId;
  stockH = await getTestAuthHeaders(UID_STOCK, { isSuperadmin: false, tenantId: T, roleCodes: ['stock'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_STOCK).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await resetTenant(T);
  if (srv) await srv.close();
  await closeDb();
});

const req = (mth, p, h, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: mth, headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test('rol stock: crea ingrediente, define receta y carga una compra que sube el stock', { skip: SKIP }, async () => {
  const ing = await req('POST', '/api/inventory/ingredients', stockH, { code: 'leche', name: 'Leche', unit: 'ml' });
  assert.equal(ing.status, 201);

  const recipe = await req('PUT', `/api/inventory/products/${ctx.productId}/recipe`, stockH, {
    yieldQty: 1, items: [{ ingredientCode: 'leche', qty: 200 }],
  });
  assert.equal(recipe.status, 200);

  const buy = await req('POST', `/api/inventory/purchases?branchId=${ctx.branchId}`, stockH, {
    items: [{ ingredientCode: 'leche', qty: 1000, unitCost: 1.5 }],
  });
  assert.equal(buy.status, 201);

  const stock = await (await req('GET', `/api/inventory/stock?branchId=${ctx.branchId}`, stockH)).json();
  const leche = stock.data.find((x) => x.code === 'leche');
  assert.equal(Number(leche.qty_on_hand), 1000);
  assert.equal(Number(leche.qty_available), 1000);

  // el ledger tiene el PURCHASE
  const mv = await (await req('GET', `/api/inventory/movements?branchId=${ctx.branchId}`, stockH)).json();
  assert.ok(mv.data.some((x) => x.type === 'PURCHASE' && Number(x.qty) === 1000));
});

test('ajuste manual con motivo -> movimiento ADJUST y queda auditado', { skip: SKIP }, async () => {
  const adj = await req('POST', `/api/inventory/stock/adjust?branchId=${ctx.branchId}`, stockH, {
    ingredientCode: 'leche', newOnHand: 800, reason: 'conteo físico',
  });
  assert.equal(adj.status, 200);
  const [[m]] = await db.query("SELECT qty FROM stock_movements WHERE tenant_id = ? AND type = 'ADJUST' ORDER BY id DESC LIMIT 1", [T]);
  assert.equal(Number(m.qty), -200); // 1000 -> 800
  const [[a]] = await db.query("SELECT reason FROM audit_log WHERE tenant_id = ? AND action = 'adjust' ORDER BY id DESC LIMIT 1", [T]);
  assert.match(a.reason, /conteo/);
});

test('un mozo NO puede ver ni tocar el stock', { skip: SKIP }, async () => {
  assert.equal((await req('GET', `/api/inventory/stock?branchId=${ctx.branchId}`, mozoH)).status, 403);
  assert.equal((await req('POST', '/api/inventory/ingredients', mozoH, { code: 'x', name: 'X' })).status, 403);
  assert.equal((await req('POST', `/api/inventory/stock/adjust?branchId=${ctx.branchId}`, mozoH, { ingredientCode: 'leche', newOnHand: 0 })).status, 403);
});
