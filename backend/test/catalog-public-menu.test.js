// Menú público (comensal, sin login) + cálculo de precio en el backend.
// No necesita Firebase: la superficie /api/public salta las capas de identidad.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { startTestServer } = require('./helpers/server');

const T = 999960;
const SLUG = 'menu-pub-test';
const BRANCH_CENTRO = 'centro';
const BRANCH_NORTE = 'norte';

let srv;
let ids = {};

async function cleanup() {
  await db.query('DELETE FROM product_branch_overrides WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM product_variants WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM products WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM menu_categories WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM menus WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM branches WHERE tenant_id = ?', [T]);
  await db.query('DELETE FROM tenants WHERE id = ?', [T]);
}

before(async () => {
  srv = await startTestServer();
  await cleanup();
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Menú Público', SLUG]);
  const [bC] = await db.query('INSERT INTO branches (tenant_id, code, name, timezone) VALUES (?, ?, ?, ?)', [
    T, BRANCH_CENTRO, 'Centro', 'America/Argentina/Buenos_Aires',
  ]);
  const [bN] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, BRANCH_NORTE, 'Norte']);
  ids.branchCentro = bC.insertId;
  ids.branchNorte = bN.insertId;

  const [menu] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'principal', 'Principal']);
  ids.menu = menu.insertId;

  // categoría siempre activa
  const [cat] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [
    T, ids.menu, 'cafeteria', 'Cafetería',
  ]);
  ids.cat = cat.insertId;
  // categoría nunca activa: days_mask=0 (ningún día habilitado) es
  // determinístico. Un active_from/active_to de '00:00'-'00:01' NO lo es
  // -- es una ventana real de un minuto por día y el test se puso flaky
  // (falló justo a las 00:00 hora de Buenos Aires).
  const [catNight] = await db.query(
    "INSERT INTO menu_categories (tenant_id, menu_id, code, name, days_mask) VALUES (?, ?, ?, ?, 0)",
    [T, ids.menu, 'trasnoche', 'Trasnoche']
  );
  ids.catNight = catNight.insertId;

  const [prod] = await db.query(
    'INSERT INTO products (tenant_id, category_id, code, name, base_price, currency, prep_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [T, ids.cat, 'cafe-latte', 'Café Latte', '4500.00', 'ARS', 5]
  );
  ids.prod = prod.insertId;
  await db.query(
    'INSERT INTO product_variants (tenant_id, product_id, code, name, price_delta, is_default) VALUES (?, ?, ?, ?, ?, 1), (?, ?, ?, ?, ?, 0)',
    [T, ids.prod, 'mediano', 'Mediano', '0.00', T, ids.prod, 'grande', 'Grande', '800.00']
  );
  // producto sólo en la categoría de trasnoche (para verificar que se oculta)
  await db.query(
    'INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)',
    [T, ids.catNight, 'submarino', 'Submarino', '3000.00']
  );
  // override de precio en la sucursal Norte
  await db.query(
    'INSERT INTO product_branch_overrides (product_id, branch_id, tenant_id, price, is_available) VALUES (?, ?, ?, ?, 1)',
    [ids.prod, ids.branchNorte, T, '4900.00']
  );
});

after(async () => {
  await cleanup();
  await srv.close();
  await db.end().catch(() => {});
});

const get = (p) => fetch(`${srv.baseUrl}${p}`);
const post = (p, body) =>
  fetch(`${srv.baseUrl}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET menú público: árbol con precio calculado por el backend', async () => {
  const res = await get(`/api/public/menu/${SLUG}/${BRANCH_CENTRO}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.branch.code, BRANCH_CENTRO);
  const cat = body.menus[0].categories.find((c) => c.code === 'cafeteria');
  assert.ok(cat, 'debe estar la categoría cafeteria');
  const latte = cat.products.find((p) => p.code === 'cafe-latte');
  assert.equal(latte.price, '4500.00');
  assert.equal(latte.currency, 'ARS');
  const grande = latte.variants.find((v) => v.code === 'grande');
  assert.equal(grande.price, '5300.00'); // 4500 + 800
});

test('la categoría fuera de su ventana horaria no aparece', async () => {
  const res = await get(`/api/public/menu/${SLUG}/${BRANCH_CENTRO}`);
  const body = await res.json();
  assert.ok(!body.menus[0].categories.some((c) => c.code === 'trasnoche'));
});

test('el override de sucursal cambia el precio mostrado', async () => {
  const res = await get(`/api/public/menu/${SLUG}/${BRANCH_NORTE}`);
  const body = await res.json();
  const latte = body.menus[0].categories.find((c) => c.code === 'cafeteria').products.find((p) => p.code === 'cafe-latte');
  assert.equal(latte.price, '4900.00');
  const grande = latte.variants.find((v) => v.code === 'grande');
  assert.equal(grande.price, '5700.00'); // 4900 + 800
});

test('POST price: el backend calcula el total desde los códigos', async () => {
  const res = await post(`/api/public/menu/${SLUG}/${BRANCH_CENTRO}/price`, {
    productCode: 'cafe-latte',
    variantCode: 'grande',
    qty: 2,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.unitPrice, '5300.00');
  assert.equal(body.lineTotal, '10600.00');
});

test('POST price: un "price" inyectado en el body se IGNORA (mandatory case #4)', async () => {
  const res = await post(`/api/public/menu/${SLUG}/${BRANCH_CENTRO}/price`, {
    productCode: 'cafe-latte',
    qty: 1,
    price: 1,
    unitPrice: '1.00',
    lineTotal: '1.00',
    base_price: '1.00',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.lineTotal, '4500.00'); // el del catálogo, no el inyectado
});

test('POST price en la sucursal Norte usa el override', async () => {
  const res = await post(`/api/public/menu/${SLUG}/${BRANCH_NORTE}/price`, { productCode: 'cafe-latte', qty: 1 });
  const body = await res.json();
  assert.equal(body.lineTotal, '4900.00');
});

test('menú de un local inexistente -> 404', async () => {
  const res = await get(`/api/public/menu/no-existe/${BRANCH_CENTRO}`);
  assert.equal(res.status, 404);
});
