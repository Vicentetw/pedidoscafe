// Aislamiento entre empresas para el catálogo — dos empresas con producto,
// categoría y menú de IGUAL código; A nunca resuelve/lista nada de B.
// Nivel repositorio + servicio del menú público. No necesita Firebase.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const repo = require('../src/modules/catalog/catalog.repository');
const svc = require('../src/modules/catalog/catalog.service');

const TA = 999970;
const TB = 999971;
const SAME_PRODUCT = 'producto-x';
const SAME_MENU = 'principal';
const SAME_CAT = 'general';

let ctx = {};

async function cleanup() {
  for (const t of [TA, TB]) {
    await db.query('DELETE FROM product_branch_overrides WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM products WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM menu_categories WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM menus WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM branches WHERE tenant_id = ?', [t]);
    await db.query('DELETE FROM tenants WHERE id = ?', [t]);
  }
}

async function seed(tid, label, price) {
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [tid, `Cat ${label}`, `cat-${label.toLowerCase()}-iso`]);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [tid, 'centro', `Centro ${label}`]);
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tid, SAME_MENU, 'Principal']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [tid, m.insertId, SAME_CAT, 'General']);
  const [p] = await db.query('INSERT INTO products (tenant_id, category_id, code, name, base_price) VALUES (?, ?, ?, ?, ?)', [
    tid, c.insertId, SAME_PRODUCT, `Producto ${label}`, price,
  ]);
  return { branchId: b.insertId, menuId: m.insertId, catId: c.insertId, productId: p.insertId };
}

before(async () => {
  await cleanup();
  ctx.a = await seed(TA, 'A', '1000.00');
  ctx.b = await seed(TB, 'B', '2000.00');
});

after(async () => {
  await cleanup();
  await db.end().catch(() => {});
});

test('findProductByCode(A, code) resuelve al producto de A, no al de B', async () => {
  const hit = await repo.findProductByCode(TA, SAME_PRODUCT);
  assert.equal(hit.id, ctx.a.productId);
});

test('findProduct(A, <producto de B>) -> null', async () => {
  assert.equal(await repo.findProduct(TA, ctx.b.productId), null);
  assert.ok(await repo.findProduct(TB, ctx.b.productId));
});

test('listProducts(A) sólo trae productos de A', async () => {
  const list = await repo.listProducts(TA);
  assert.ok(list.length >= 1);
  assert.ok(list.every((p) => p.tenant_id === TA));
});

test('findCategory(A, <categoría de B>) -> null', async () => {
  assert.equal(await repo.findCategory(TA, ctx.b.catId), null);
});

test('buildPublicMenu(A) no incluye nada de B', async () => {
  const tree = await repo.buildPublicMenu(TA, ctx.a.branchId);
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('Producto A'));
  assert.ok(!flat.includes('Producto B'));
});

test('getPublicMenu por slug de A muestra el precio de A (1000), no el de B (2000)', async () => {
  const menu = await svc.getPublicMenu(TA, 'centro');
  const prod = menu.menus[0].categories[0].products[0];
  assert.equal(prod.price, '1000.00');
});

test('priceLinePreview(A) usa el catálogo de A', async () => {
  const r = await svc.priceLinePreview(TA, 'centro', { productCode: SAME_PRODUCT, qty: 3 });
  assert.equal(r.lineTotal, '3000.00'); // 1000 * 3, no 2000
});
