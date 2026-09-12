// Stock simple por producto (pedido en la aceptación): track_stock/
// stock_qty/stock_min en `products`, sin recetas. Confirma que:
//  - confirmar un pedido descuenta stock, y lo bloquea si no alcanza;
//  - cancelar un pedido YA confirmado lo devuelve (uno DRAFT nunca
//    descontado no debe "inflar" el stock al cancelarse);
//  - el menú público dejar de mostrar el producto disponible en 0;
//  - track_stock=false (el caso "café", sin límite) nunca bloquea nada.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const catalogSvc = require('../src/modules/catalog/catalog.service');
const tablesRepo = require('../src/modules/tables/tables.repository');
const tablesSvc = require('../src/modules/tables/tables.service');
const orderSvc = require('../src/modules/orders/orders.service');

const T = 998470;
let ctx = {};
const guest = { kind: 'guest', actorId: null };

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Stock Simple', 'stock-simple-test']);
  const [b] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [T, 'centro', 'Centro']);
  ctx.branchId = b.insertId;
  ctx.branchCode = 'centro';
  const [m] = await db.query('INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [T, 'p', 'P']);
  const [c] = await db.query('INSERT INTO menu_categories (tenant_id, menu_id, code, name) VALUES (?, ?, ?, ?)', [T, m.insertId, 'g', 'G']);
  ctx.categoryId = c.insertId;
  await db.query(
    `INSERT INTO products (tenant_id, category_id, code, name, base_price, track_stock, stock_qty, stock_min)
     VALUES (?, ?, 'medialuna', 'Medialuna', '500.00', 1, 2, 1)`,
    [T, c.insertId]
  );
  await db.query(
    `INSERT INTO products (tenant_id, category_id, code, name, base_price, track_stock) VALUES (?, ?, 'cafe', 'Café', '1000.00', 0)`,
    [T, c.insertId]
  );
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

let n = 0;
async function orderOf(productCode, qty) {
  n += 1;
  const [t] = await db.query('INSERT INTO tables (tenant_id, branch_id, code) VALUES (?, ?, ?)', [T, ctx.branchId, `S${n}`]);
  const qr = await tablesRepo.createQrToken(T, ctx.branchId, t.insertId);
  const started = await tablesSvc.startSession(qr, { displayName: `C${n}` }, {});
  const [[p]] = await db.query('SELECT id FROM session_participants WHERE public_id = ?', [started.participant.id]);
  const [[sess]] = await db.query('SELECT id FROM table_sessions WHERE public_id = ?', [started.session.id]);
  const o = await orderSvc.createOrder(T, { branchId: ctx.branchId, sessionId: sess.id, participantId: p.id, channel: 'TABLE' }, guest);
  await orderSvc.addItem(T, o.id, { productCode, qty }, guest);
  return o.id;
}

test('confirmar un pedido descuenta el stock simple del producto', async () => {
  const [[before]] = await db.query('SELECT stock_qty FROM products WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);
  assert.equal(before.stock_qty, 2);

  const orderId = await orderOf('medialuna', 1);
  const submitted = await orderSvc.submitOrder(T, orderId, guest);
  assert.equal(submitted.status, 'QUEUED'); // sin estaciones configuradas, CONFIRMED pasa directo a QUEUED

  const [[after]] = await db.query('SELECT stock_qty FROM products WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);
  assert.equal(after.stock_qty, 1);
});

test('pedir más de lo que queda -> mensaje humano + queda REJECTED_STOCK, sin descontar nada', async () => {
  const orderId = await orderOf('medialuna', 5); // sólo queda 1 (test anterior lo dejó en 1)
  await assert.rejects(
    () => orderSvc.submitOrder(T, orderId, guest),
    (err) => { assert.equal(err.code, 'ITEM_UNAVAILABLE'); return true; }
  );

  const [[order]] = await db.query('SELECT status FROM orders WHERE id = ?', [orderId]);
  assert.equal(order.status, 'REJECTED_STOCK');

  const [[after]] = await db.query('SELECT stock_qty FROM products WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);
  assert.equal(after.stock_qty, 1, 'no se tocó el stock — se rechazó antes de aplicar nada');
});

test('cancelar un pedido YA CONFIRMADO devuelve el stock', async () => {
  const orderId = await orderOf('medialuna', 1);
  await orderSvc.submitOrder(T, orderId, guest);
  const [[mid]] = await db.query('SELECT stock_qty FROM products WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);
  assert.equal(mid.stock_qty, 0, 'se agotó');

  await orderSvc.cancelOrder(T, orderId, { reason: 'test' }, { kind: 'staff', actorId: null, canCancelAfterPrep: true });
  const [[after]] = await db.query('SELECT stock_qty FROM products WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);
  assert.equal(after.stock_qty, 1, 'se devolvió al cancelar');
});

test('cancelar un pedido que NUNCA se confirmó (DRAFT) no infla el stock', async () => {
  const orderId = await orderOf('medialuna', 1); // queda en DRAFT, nunca se llama submitOrder
  const [[before]] = await db.query('SELECT stock_qty FROM products WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);

  await orderSvc.cancelOrder(T, orderId, { reason: 'test' }, guest);
  const [[after]] = await db.query('SELECT stock_qty FROM products WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);
  assert.equal(after.stock_qty, before.stock_qty, 'nunca se descontó, así que cancelar no debe sumar de más');
});

test('en 0, el producto deja de aparecer disponible en el menú público', async () => {
  await db.query('UPDATE products SET stock_qty = 0 WHERE tenant_id = ? AND code = ?', [T, 'medialuna']);
  const menu = await catalogSvc.getPublicMenu(T, ctx.branchCode);
  const products = menu.menus.flatMap((m) => m.categories).flatMap((c) => c.products);
  const medialuna = products.find((p) => p.code === 'medialuna');
  assert.ok(medialuna, 'sigue listado (no se borra), pero...');
  assert.equal(medialuna.available, false);
});

test('track_stock=false (café) nunca se ve limitado, cualquiera sea la cantidad', async () => {
  const orderId = await orderOf('cafe', 500); // cantidad absurda a propósito
  const result = await orderSvc.submitOrder(T, orderId, guest);
  assert.equal(result.status, 'QUEUED', 'sin track_stock, no hay ningún tope');
});
