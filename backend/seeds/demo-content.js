#!/usr/bin/env node
// Contenido de DEMO para poder mirar la app funcionando. Idempotente.
// Puebla la empresa "Café Demo" (tenant slug cafe-demo, sucursal "centro")
// con menú, productos, mesas + QR y estaciones de cocina, y crea/actualiza
// un usuario dueño real en Firebase para poder entrar al back-office.
//
//   node seeds/demo-content.js
//
// NO corre con NODE_ENV=production.

const { config, assertDbConfig } = require('../src/config');
assertDbConfig();
const db = require('../src/db');
const admin = require('firebase-admin');
const { initFirebaseAdmin, isFirebaseReady } = require('../src/auth/firebase');
const tablesRepo = require('../src/modules/tables/tables.repository');
const invRepo = require('../src/modules/inventory/inventory.repository');
const { withTransaction } = require('../src/withTransaction');

const OWNER_EMAIL = 'owner@cafedemo.test';
const OWNER_PASS = 'demo1234';
const FRONT = process.env.FRONT_URL || 'http://localhost:4200';

async function one(sql, params) {
  const [rows] = await db.query(sql, params);
  return rows[0] || null;
}

async function ensureTenant() {
  let t = await one('SELECT id FROM tenants WHERE slug = ?', ['cafe-demo']);
  if (!t) {
    const [r] = await db.query('INSERT INTO tenants (name, slug) VALUES (?, ?)', ['Café Demo', 'cafe-demo']);
    t = { id: r.insertId };
  }
  let b = await one('SELECT id FROM branches WHERE tenant_id = ? AND code = ?', [t.id, 'centro']);
  if (!b) {
    const [r] = await db.query('INSERT INTO branches (tenant_id, code, name) VALUES (?, ?, ?)', [t.id, 'centro', 'Centro']);
    b = { id: r.insertId };
  }
  return { tenantId: t.id, branchId: b.id };
}

async function ensureOwner(tenantId) {
  initFirebaseAdmin();
  if (!isFirebaseReady()) {
    console.log('!! Firebase Admin no configurado — no se crea el usuario dueño.');
    return;
  }
  let fb;
  try {
    fb = await admin.auth().getUserByEmail(OWNER_EMAIL);
    await admin.auth().updateUser(fb.uid, { password: OWNER_PASS });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    fb = await admin.auth().createUser({ email: OWNER_EMAIL, password: OWNER_PASS });
  }
  await db.query(
    `INSERT INTO app_users (firebase_uid, email, tenant_id, is_superadmin, status)
     VALUES (?, ?, ?, 0, 'active')
     ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), is_superadmin = 0, status = 'active'`,
    [fb.uid, OWNER_EMAIL, tenantId]
  );
  const u = await one('SELECT id FROM app_users WHERE firebase_uid = ?', [fb.uid]);
  const role = await one("SELECT id FROM roles WHERE code = 'owner' AND tenant_id IS NULL");
  await db.query('INSERT INTO user_roles (app_user_id, role_id, branch_id) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE role_id = role_id', [u.id, role.id]);
}

async function upsert(table, findSql, findParams, insertSql, insertParams) {
  const existing = await one(findSql, findParams);
  if (existing) return existing.id;
  const [r] = await db.query(insertSql, insertParams);
  return r.insertId;
}

async function seedCatalog(tenantId) {
  const menuId = await upsert('menus',
    'SELECT id FROM menus WHERE tenant_id = ? AND code = ? AND branch_id IS NULL', [tenantId, 'ppal'],
    'INSERT INTO menus (tenant_id, branch_id, code, name) VALUES (?, NULL, ?, ?)', [tenantId, 'ppal', 'Principal']);

  const cats = {};
  for (const [code, name, icon, sort] of [
    ['cafeteria', 'Cafetería', '☕', 1],
    ['pasteleria', 'Pastelería', '🥐', 2],
    ['hamburguesas', 'Hamburguesas', '🍔', 3],
    ['bebidas', 'Bebidas', '🍺', 4],
  ]) {
    cats[code] = await upsert('menu_categories',
      'SELECT id FROM menu_categories WHERE tenant_id = ? AND menu_id = ? AND code = ?', [tenantId, menuId, code],
      'INSERT INTO menu_categories (tenant_id, menu_id, code, name, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [tenantId, menuId, code, name, icon, sort]);
  }

  const P = async (catCode, code, name, price, opts = {}) => {
    const id = await upsert('products',
      'SELECT id FROM products WHERE tenant_id = ? AND code = ?', [tenantId, code],
      'INSERT INTO products (tenant_id, category_id, code, name, description, base_price, prep_minutes, requires_age_verification) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [tenantId, cats[catCode], code, name, opts.desc || null, price, opts.prep || 5, opts.age ? 1 : 0]);
    for (const [vcode, vname, delta, def] of opts.variants || []) {
      await upsert('product_variants',
        'SELECT id FROM product_variants WHERE tenant_id = ? AND product_id = ? AND code = ?', [tenantId, id, vcode],
        'INSERT INTO product_variants (tenant_id, product_id, code, name, price_delta, is_default) VALUES (?, ?, ?, ?, ?, ?)',
        [tenantId, id, vcode, vname, delta, def ? 1 : 0]);
    }
    return id;
  };

  await P('cafeteria', 'espresso', 'Espresso', '1800.00', { prep: 3 });
  const latte = await P('cafeteria', 'latte', 'Café Latte', '4500.00', {
    desc: 'Con leche vaporizada y una nube de espuma.',
    variants: [['chico', 'Chico', '-400.00', false], ['mediano', 'Mediano', '0.00', true], ['grande', 'Grande', '800.00', false]],
  });
  await P('cafeteria', 'capuccino', 'Capuccino', '4200.00', {});
  await P('pasteleria', 'medialuna', 'Medialuna', '1200.00', { prep: 1 });
  await P('pasteleria', 'budin', 'Budín de limón', '2600.00', {});
  await P('hamburguesas', 'clasica', 'Hamburguesa clásica', '9800.00', { prep: 12, desc: 'Carne, cheddar, lechuga y tomate.' });
  await P('hamburguesas', 'doble', 'Doble bacon', '13500.00', { prep: 14 });
  await P('bebidas', 'agua', 'Agua mineral', '1500.00', { prep: 1 });
  await P('bebidas', 'gaseosa', 'Gaseosa', '2200.00', { prep: 1 });
  await P('bebidas', 'cerveza', 'Cerveza artesanal', '4800.00', { prep: 2, age: true, desc: 'Requiere verificación de edad.' });

  // tags
  const tagNuevo = await upsert('product_tags',
    'SELECT id FROM product_tags WHERE tenant_id = ? AND code = ?', [tenantId, 'nuevo'],
    'INSERT INTO product_tags (tenant_id, code, label, color) VALUES (?, ?, ?, ?)', [tenantId, 'nuevo', 'Nuevo', '#2e7d32']);
  await db.query('INSERT INTO product_tag_map (product_id, tag_id, tenant_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tag_id = tag_id', [latte, tagNuevo, tenantId]);

  return { menuId, catBebidas: cats['bebidas'] };
}

async function seedTables(tenantId, branchId) {
  const links = [];
  for (const code of ['M1', 'M2', 'M3', 'M4']) {
    let t = await one('SELECT id FROM tables WHERE tenant_id = ? AND branch_id = ? AND code = ?', [tenantId, branchId, code]);
    if (!t) {
      const [r] = await db.query('INSERT INTO tables (tenant_id, branch_id, code, name, seats) VALUES (?, ?, ?, ?, ?)', [tenantId, branchId, code, `Mesa ${code.slice(1)}`, 4]);
      t = { id: r.insertId };
    }
    let q = await one("SELECT token FROM qr_tokens WHERE tenant_id = ? AND table_id = ? AND status = 'ACTIVE'", [tenantId, t.id]);
    if (!q) q = { token: await tablesRepo.createQrToken(tenantId, branchId, t.id) };
    links.push({ code, url: `${FRONT}/t/${q.token}` });
  }
  return links;
}

async function seedKitchen(tenantId, branchId, catBebidas) {
  const stCocina = await upsert('kitchen_stations',
    'SELECT id FROM kitchen_stations WHERE tenant_id = ? AND branch_id = ? AND code = ?', [tenantId, branchId, 'cocina'],
    'INSERT INTO kitchen_stations (tenant_id, branch_id, code, name, type, is_default) VALUES (?, ?, ?, ?, ?, 1)', [tenantId, branchId, 'cocina', 'Cocina', 'KITCHEN']);
  const stBarra = await upsert('kitchen_stations',
    'SELECT id FROM kitchen_stations WHERE tenant_id = ? AND branch_id = ? AND code = ?', [tenantId, branchId, 'barra'],
    'INSERT INTO kitchen_stations (tenant_id, branch_id, code, name, type) VALUES (?, ?, ?, ?, ?)', [tenantId, branchId, 'barra', 'Barra', 'BAR']);
  await db.query(
    `INSERT INTO product_station_routing (tenant_id, branch_id, category_id, station_id) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE station_id = VALUES(station_id)`,
    [tenantId, branchId, catBebidas, stBarra]);
  void stCocina;
}

async function seedStock(tenantId, branchId) {
  const ing = async (code, name, unit, tracked = true) => {
    const found = await invRepo.findIngredientByCode(tenantId, code);
    if (found) return found.id;
    return invRepo.createIngredient(tenantId, { code, name, unit, isTracked: tracked });
  };
  const pan = await ing('pan', 'Pan de hamburguesa', 'unit');
  const carne = await ing('carne', 'Medallón de carne', 'g');
  const leche = await ing('leche', 'Leche', 'ml');
  const medialunaU = await ing('medialuna_u', 'Medialuna (unidad)', 'unit');

  const prod = async (code) => (await one('SELECT id FROM products WHERE tenant_id = ? AND code = ?', [tenantId, code])).id;
  const setRecipe = async (productCode, items) => {
    const pid = await prod(productCode);
    await withTransaction((conn) => invRepo.upsertRecipe(tenantId, pid, null, 1, items, conn));
  };
  await setRecipe('clasica', [{ ingredientId: pan, qty: 1 }, { ingredientId: carne, qty: 150 }]);
  await setRecipe('doble', [{ ingredientId: pan, qty: 1 }, { ingredientId: carne, qty: 300 }]);
  await setRecipe('latte', [{ ingredientId: leche, qty: 200 }]);
  await setRecipe('capuccino', [{ ingredientId: leche, qty: 150 }]);
  await setRecipe('medialuna', [{ ingredientId: medialunaU, qty: 1 }]);

  const stock = { [pan]: 20, [carne]: 600, [leche]: 3000, [medialunaU]: 8 }; // carne alcanza ~4 clásicas / 2 dobles
  for (const [ingId, qty] of Object.entries(stock)) {
    await invRepo.ensureStockRow(tenantId, branchId, Number(ingId));
    await db.query('UPDATE stock SET qty_on_hand = ? WHERE tenant_id = ? AND branch_id = ? AND ingredient_id = ?', [qty, tenantId, branchId, ingId]);
  }
}

async function main() {
  if (config.env === 'production') { console.error('demo-content.js no corre en producción.'); process.exit(1); }
  const { tenantId, branchId } = await ensureTenant();
  await ensureOwner(tenantId);
  const { catBebidas } = await seedCatalog(tenantId);
  const links = await seedTables(tenantId, branchId);
  await seedKitchen(tenantId, branchId, catBebidas);
  await seedStock(tenantId, branchId);

  console.log('\n=== DEMO lista ===');
  console.log(`Back-office:  ${FRONT}/admin`);
  console.log(`  usuario:    ${OWNER_EMAIL}`);
  console.log(`  contraseña: ${OWNER_PASS}`);
  console.log(`Menú público: ${FRONT}/m/cafe-demo/centro`);
  console.log('Mesas (abrí en el celular o en una pestaña):');
  for (const l of links) console.log(`  ${l.code}: ${l.url}`);
  console.log('');
  await db.end();
}

main().catch(async (e) => { console.error(e); await db.end().catch(() => {}); process.exit(1); });
