// Catálogo — back-office por HTTP. Verifica el circuito menú→categoría→
// producto→variante→precio y el gating de permisos (catalog:manage /
// catalog:update_price). Necesita Firebase (usa ID token real).
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { startTestServer } = require('./helpers/server');
const { getTestAuthHeaders, deleteTestUser, closeDb } = require('./helpers/firebaseTestAuth');
const { integrationEnv } = require('./helpers/env');

const { ok: RUN, skip: SKIP } = integrationEnv();
const T = 999980;
const UID_ADMIN = 'test-catalog-admin';
const UID_MOZO = 'test-catalog-mozo';

let srv;
let adminH;
let mozoH;

async function cleanup() {
  await db.query('DELETE FROM audit_log WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM product_variants WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM products WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM menu_categories WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM menus WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM user_roles WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [T]);
  await db.query('DELETE FROM user_permissions WHERE app_user_id IN (SELECT id FROM app_users WHERE tenant_id = ?)', [T]);
  await db.query('DELETE FROM app_users WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM branches WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tenants WHERE id = ?', [T]);
}

before(async () => {
  if (!RUN) return;
  srv = await startTestServer();
  await cleanup();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Catálogo admin', 'catalogo-admin-test']);
  adminH = await getTestAuthHeaders(UID_ADMIN, { isSuperadmin: false, tenantId: T, roleCodes: ['admin_general'] });
  mozoH = await getTestAuthHeaders(UID_MOZO, { isSuperadmin: false, tenantId: T, roleCodes: ['mozo'] });
});

after(async () => {
  if (!RUN) return;
  await deleteTestUser(UID_ADMIN).catch(() => {});
  await deleteTestUser(UID_MOZO).catch(() => {});
  await cleanup();
  await srv.close();
  await closeDb();
});

const req = (method, path, headers, body) =>
  fetch(`${srv.baseUrl}${path}`, {
    method,
    headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test('admin crea menú → categoría → producto → variante', { skip: SKIP }, async () => {
  const m = await (await req('POST', '/api/catalog/menus', adminH, { code: 'principal', name: 'Principal' })).json();
  assert.ok(m.id);
  const c = await (await req('POST', '/api/catalog/categories', adminH, { menuId: m.id, code: 'cafe', name: 'Cafetería' })).json();
  assert.ok(c.id);
  const pRes = await req('POST', '/api/catalog/products', adminH, {
    categoryId: c.id, code: 'latte', name: 'Latte', basePrice: 4500,
  });
  assert.equal(pRes.status, 201);
  const p = await pRes.json();
  assert.equal(p.base_price, '4500.00');
  const vRes = await req('POST', `/api/catalog/products/${p.id}/variants`, adminH, { code: 'grande', name: 'Grande', priceDelta: 800 });
  assert.equal(vRes.status, 201);
});

test('un mozo NO puede crear un producto -> 403', { skip: SKIP }, async () => {
  const [[cat]] = await db.query('SELECT id FROM menu_categories WHERE tenant_id = ? LIMIT 1', [T]);
  const res = await req('POST', '/api/catalog/products', mozoH, { categoryId: cat.id, code: 'x', name: 'X', basePrice: 1 });
  assert.equal(res.status, 403);
});

test('cambiar precio va por su propio endpoint y exige catalog:update_price', { skip: SKIP }, async () => {
  const [[p]] = await db.query('SELECT id FROM products WHERE tenant_id = ? AND code = ?', [T, 'latte']);
  // admin_general tiene catalog:update_price
  const ok = await req('PUT', `/api/catalog/products/${p.id}/price`, adminH, { basePrice: 4900 });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).base_price, '4900.00');
  // el PATCH general NO debe aceptar basePrice (lo ignora el schema)
  const patched = await req('PATCH', `/api/catalog/products/${p.id}`, adminH, { name: 'Latte grande', basePrice: 1 });
  assert.equal(patched.status, 200);
  const [[after]] = await db.query('SELECT base_price, name FROM products WHERE id = ?', [p.id]);
  assert.equal(after.base_price, '4900.00'); // NO cambió por el PATCH
  assert.equal(after.name, 'Latte grande');
  // queda auditado como update_price
  const [[a]] = await db.query("SELECT COUNT(*) n FROM audit_log WHERE tenant_id = ? AND action = 'update_price'", [T]);
  assert.ok(a.n >= 1);
});

test('un mozo NO puede cambiar precios -> 403', { skip: SKIP }, async () => {
  const [[p]] = await db.query('SELECT id FROM products WHERE tenant_id = ? AND code = ?', [T, 'latte']);
  const res = await req('PUT', `/api/catalog/products/${p.id}/price`, mozoH, { basePrice: 1 });
  assert.equal(res.status, 403);
});
