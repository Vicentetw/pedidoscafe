const pool = require('../../db');

// Repo del catálogo. Secciones: menús, categorías, productos (+ overrides
// por sucursal), variantes, grupos de modificadores + modificadores, tags,
// y buildPublicMenu() que arma el árbol para la API pública.
// tenantId SIEMPRE primero; todo WHERE lo lleva.

// ---------------------------------------------------------------- menús
async function listMenus(tenantId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, tenant_id, branch_id, code, name, status, sort_order
       FROM menus WHERE tenant_id = :tenantId AND deleted_at IS NULL
      ORDER BY sort_order, name`,
    { tenantId }
  );
  return rows;
}
async function findMenu(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, branch_id, code, name, status, sort_order
       FROM menus WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return row || null;
}
async function findMenuByCode(tenantId, branchId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM menus
      WHERE tenant_id = :tenantId AND code = :code
        AND COALESCE(branch_id, 0) = COALESCE(:branchId, 0) AND deleted_at IS NULL`,
    { tenantId, branchId: branchId ?? null, code }
  );
  return row || null;
}
async function createMenu(tenantId, d, actor, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO menus (tenant_id, branch_id, code, name, status, sort_order, created_by, updated_by)
     VALUES (:tenantId, :branchId, :code, :name, :status, :sortOrder, :actor, :actor)`,
    { tenantId, branchId: d.branchId ?? null, code: d.code, name: d.name, status: d.status ?? 'active', sortOrder: d.sortOrder ?? 0, actor: actor ?? null }
  );
  return r.insertId;
}
async function updateMenu(tenantId, id, patch, actor, conn = pool) {
  const f = ['updated_by = :actor'];
  const p = { tenantId, id, actor: actor ?? null };
  for (const k of ['name', 'status']) if (patch[k] !== undefined) { f.push(`${k} = :${k}`); p[k] = patch[k]; }
  if (patch.sortOrder !== undefined) { f.push('sort_order = :sortOrder'); p.sortOrder = patch.sortOrder; }
  await conn.query(`UPDATE menus SET ${f.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, p);
}
async function softDeleteMenu(tenantId, id, conn = pool) {
  await conn.query(`UPDATE menus SET deleted_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`, { tenantId, id });
}

// ----------------------------------------------------------- categorías
async function listCategories(tenantId, menuId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, tenant_id, menu_id, code, name, icon, sort_order, active_from, active_to, days_mask, status
       FROM menu_categories
      WHERE tenant_id = :tenantId AND menu_id = :menuId AND deleted_at IS NULL
      ORDER BY sort_order, name`,
    { tenantId, menuId }
  );
  return rows;
}
async function findCategory(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id, tenant_id, menu_id, code, name, icon, sort_order, active_from, active_to, days_mask, status
       FROM menu_categories WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return row || null;
}
async function findCategoryByCode(tenantId, menuId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM menu_categories WHERE tenant_id = :tenantId AND menu_id = :menuId AND code = :code AND deleted_at IS NULL`,
    { tenantId, menuId, code }
  );
  return row || null;
}
async function createCategory(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO menu_categories (tenant_id, menu_id, code, name, icon, sort_order, active_from, active_to, days_mask, status)
     VALUES (:tenantId, :menuId, :code, :name, :icon, :sortOrder, :activeFrom, :activeTo, :daysMask, :status)`,
    {
      tenantId, menuId: d.menuId, code: d.code, name: d.name, icon: d.icon ?? null,
      sortOrder: d.sortOrder ?? 0, activeFrom: d.activeFrom ?? null, activeTo: d.activeTo ?? null,
      daysMask: d.daysMask ?? null, status: d.status ?? 'active',
    }
  );
  return r.insertId;
}
async function updateCategory(tenantId, id, patch, conn = pool) {
  const f = [];
  const p = { tenantId, id };
  const map = { name: 'name', icon: 'icon', status: 'status', sortOrder: 'sort_order', activeFrom: 'active_from', activeTo: 'active_to', daysMask: 'days_mask' };
  for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) { f.push(`${col} = :${k}`); p[k] = patch[k]; }
  if (!f.length) return;
  await conn.query(`UPDATE menu_categories SET ${f.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, p);
}
async function softDeleteCategory(tenantId, id, conn = pool) {
  await conn.query(`UPDATE menu_categories SET deleted_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`, { tenantId, id });
}
async function categoryHasProducts(tenantId, id, conn = pool) {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) n FROM products WHERE tenant_id = :tenantId AND category_id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return n > 0;
}

// ------------------------------------------------------------- productos
const PRODUCT_COLS = `id, tenant_id, category_id, code, name, description, base_price, currency,
  image_url, prep_minutes, requires_age_verification, is_active, sort_order,
  track_stock, stock_qty, stock_min`;

async function listProducts(tenantId, { categoryId } = {}, conn = pool) {
  const [rows] = await conn.query(
    `SELECT ${PRODUCT_COLS} FROM products
      WHERE tenant_id = :tenantId AND deleted_at IS NULL
        ${categoryId ? 'AND category_id = :categoryId' : ''}
      ORDER BY sort_order, name`,
    { tenantId, categoryId }
  );
  return rows;
}
async function findProduct(tenantId, id, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT ${PRODUCT_COLS} FROM products WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`,
    { tenantId, id }
  );
  return row || null;
}
async function findProductByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM products WHERE tenant_id = :tenantId AND code = :code AND deleted_at IS NULL`,
    { tenantId, code }
  );
  return row || null;
}
async function createProduct(tenantId, d, actor, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO products (tenant_id, category_id, code, name, description, base_price, currency,
       image_url, prep_minutes, requires_age_verification, is_active, sort_order,
       track_stock, stock_qty, stock_min, created_by, updated_by)
     VALUES (:tenantId, :categoryId, :code, :name, :description, :basePrice, :currency,
       :imageUrl, :prepMinutes, :ageVer, :isActive, :sortOrder,
       :trackStock, :stockQty, :stockMin, :actor, :actor)`,
    {
      tenantId, categoryId: d.categoryId, code: d.code, name: d.name, description: d.description ?? null,
      basePrice: d.basePrice, currency: d.currency ?? 'ARS', imageUrl: d.imageUrl ?? null,
      prepMinutes: d.prepMinutes ?? 0, ageVer: d.requiresAgeVerification ? 1 : 0,
      isActive: d.isActive === false ? 0 : 1, sortOrder: d.sortOrder ?? 0,
      trackStock: d.trackStock ? 1 : 0, stockQty: d.stockQty ?? null, stockMin: d.stockMin ?? null,
      actor: actor ?? null,
    }
  );
  return r.insertId;
}
// patch de datos generales (NO precio — el precio va por updateProductPrice,
// que exige el permiso catalog:update_price)
async function updateProduct(tenantId, id, patch, actor, conn = pool) {
  const f = ['updated_by = :actor'];
  const p = { tenantId, id, actor: actor ?? null };
  const map = {
    categoryId: 'category_id', name: 'name', description: 'description', currency: 'currency',
    imageUrl: 'image_url', prepMinutes: 'prep_minutes', sortOrder: 'sort_order',
    stockQty: 'stock_qty', stockMin: 'stock_min',
  };
  for (const [k, col] of Object.entries(map)) if (patch[k] !== undefined) { f.push(`${col} = :${k}`); p[k] = patch[k]; }
  if (patch.requiresAgeVerification !== undefined) { f.push('requires_age_verification = :ageVer'); p.ageVer = patch.requiresAgeVerification ? 1 : 0; }
  if (patch.isActive !== undefined) { f.push('is_active = :isActive'); p.isActive = patch.isActive ? 1 : 0; }
  if (patch.trackStock !== undefined) { f.push('track_stock = :trackStock'); p.trackStock = patch.trackStock ? 1 : 0; }
  await conn.query(`UPDATE products SET ${f.join(', ')} WHERE tenant_id = :tenantId AND id = :id`, p);
}
// Decremento/restitución ATÓMICOS del stock simple — el WHERE con
// stock_qty >= :qty hace de guarda de carrera sin necesitar lockear la
// fila a mano: si dos confirmaciones concurrentes se pisan, sólo una
// gana (affectedRows lo delata). Al llegar a 0 el producto deja de
// aparecer/poder pedirse (mismo chequeo que ya usa todo lo demás).
async function decrementStock(tenantId, productId, qty, conn = pool) {
  const [r] = await conn.query(
    `UPDATE products SET stock_qty = stock_qty - :qty
      WHERE tenant_id = :tenantId AND id = :productId AND track_stock = 1 AND stock_qty >= :qty`,
    { tenantId, productId, qty }
  );
  return r.affectedRows > 0;
}
async function restoreStock(tenantId, productId, qty, conn = pool) {
  await conn.query(
    `UPDATE products SET stock_qty = stock_qty + :qty
      WHERE tenant_id = :tenantId AND id = :productId AND track_stock = 1 AND stock_qty IS NOT NULL`,
    { tenantId, productId, qty }
  );
}
async function findStockInfo(tenantId, productId, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT track_stock, stock_qty, stock_min, name FROM products WHERE tenant_id = :tenantId AND id = :productId`,
    { tenantId, productId }
  );
  return row || null;
}
async function updateProductBasePrice(tenantId, id, basePrice, actor, conn = pool) {
  await conn.query(
    `UPDATE products SET base_price = :basePrice, updated_by = :actor WHERE tenant_id = :tenantId AND id = :id`,
    { tenantId, id, basePrice, actor: actor ?? null }
  );
}
async function softDeleteProduct(tenantId, id, conn = pool) {
  await conn.query(`UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE tenant_id = :tenantId AND id = :id AND deleted_at IS NULL`, { tenantId, id });
}

// override por sucursal
async function upsertBranchOverride(tenantId, productId, branchId, { price, isAvailable }, conn = pool) {
  await conn.query(
    `INSERT INTO product_branch_overrides (product_id, branch_id, tenant_id, price, is_available)
     VALUES (:productId, :branchId, :tenantId, :price, :isAvailable)
     ON DUPLICATE KEY UPDATE price = VALUES(price), is_available = VALUES(is_available)`,
    { tenantId, productId, branchId, price: price ?? null, isAvailable: isAvailable === false ? 0 : 1 }
  );
}
async function listBranchOverrides(tenantId, productId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT branch_id, price, is_available FROM product_branch_overrides
      WHERE tenant_id = :tenantId AND product_id = :productId`,
    { tenantId, productId }
  );
  return rows;
}

// ------------------------------------------------------------- variantes
async function listVariants(tenantId, productId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT id, product_id, code, name, price_delta, prep_minutes_delta, is_default, sort_order, is_active
       FROM product_variants WHERE tenant_id = :tenantId AND product_id = :productId
      ORDER BY sort_order, name`,
    { tenantId, productId }
  );
  return rows;
}
async function findVariantByCode(tenantId, productId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM product_variants WHERE tenant_id = :tenantId AND product_id = :productId AND code = :code`,
    { tenantId, productId, code }
  );
  return row || null;
}
async function createVariant(tenantId, productId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO product_variants (tenant_id, product_id, code, name, price_delta, prep_minutes_delta, is_default, sort_order, is_active)
     VALUES (:tenantId, :productId, :code, :name, :priceDelta, :prepDelta, :isDefault, :sortOrder, :isActive)`,
    {
      tenantId, productId, code: d.code, name: d.name, priceDelta: d.priceDelta ?? 0,
      prepDelta: d.prepMinutesDelta ?? 0, isDefault: d.isDefault ? 1 : 0,
      sortOrder: d.sortOrder ?? 0, isActive: d.isActive === false ? 0 : 1,
    }
  );
  return r.insertId;
}
async function deleteVariant(tenantId, productId, id, conn = pool) {
  await conn.query(`DELETE FROM product_variants WHERE tenant_id = :tenantId AND product_id = :productId AND id = :id`, { tenantId, productId, id });
}

// -------------------------------------------- grupos de modificadores
async function listModifierGroups(tenantId, conn = pool) {
  const [groups] = await conn.query(
    `SELECT id, code, name, min_select, max_select, required FROM modifier_groups
      WHERE tenant_id = :tenantId AND deleted_at IS NULL ORDER BY name`,
    { tenantId }
  );
  // Sin IN(?) — el pool usa namedPlaceholders y no se pueden mezclar. Se
  // traen todos los modifiers del tenant y se agrupan en JS (no hay
  // volumen que lo justifique de otra forma en un catálogo).
  const [mods] = await conn.query(
    `SELECT id, group_id, code, name, price_delta, sort_order, is_active FROM modifiers
      WHERE tenant_id = :tenantId ORDER BY sort_order, name`,
    { tenantId }
  );
  const byGroup = new Map();
  for (const m of mods) {
    if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, []);
    byGroup.get(m.group_id).push(m);
  }
  return groups.map((g) => ({ ...g, modifiers: byGroup.get(g.id) || [] }));
}
async function findModifierGroupByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT id FROM modifier_groups WHERE tenant_id = :tenantId AND code = :code AND deleted_at IS NULL`,
    { tenantId, code }
  );
  return row || null;
}
async function createModifierGroup(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO modifier_groups (tenant_id, code, name, min_select, max_select, required)
     VALUES (:tenantId, :code, :name, :minSelect, :maxSelect, :required)`,
    { tenantId, code: d.code, name: d.name, minSelect: d.minSelect ?? 0, maxSelect: d.maxSelect ?? 1, required: d.required ? 1 : 0 }
  );
  return r.insertId;
}
async function addModifier(tenantId, groupId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO modifiers (tenant_id, group_id, code, name, price_delta, sort_order, is_active)
     VALUES (:tenantId, :groupId, :code, :name, :priceDelta, :sortOrder, :isActive)`,
    { tenantId, groupId, code: d.code, name: d.name, priceDelta: d.priceDelta ?? 0, sortOrder: d.sortOrder ?? 0, isActive: d.isActive === false ? 0 : 1 }
  );
  return r.insertId;
}
async function setProductModifierGroups(tenantId, productId, groupIds, conn = pool) {
  await conn.query(`DELETE FROM product_modifier_groups WHERE tenant_id = :tenantId AND product_id = :productId`, { tenantId, productId });
  if (groupIds.length) {
    await conn.query(`INSERT INTO product_modifier_groups (product_id, group_id, tenant_id, sort_order) VALUES ?`, [
      groupIds.map((gid, i) => [productId, gid, tenantId, i]),
    ]);
  }
}
async function listProductModifierGroups(tenantId, productId, conn = pool) {
  const [rows] = await conn.query(
    `SELECT g.id, g.code, g.name, g.min_select, g.max_select, g.required, pmg.sort_order
       FROM product_modifier_groups pmg
       JOIN modifier_groups g ON g.id = pmg.group_id AND g.deleted_at IS NULL
      WHERE pmg.tenant_id = :tenantId AND pmg.product_id = :productId
      ORDER BY pmg.sort_order`,
    { tenantId, productId }
  );
  return rows;
}

// ------------------------------------------------------------------ tags
async function listTags(tenantId, conn = pool) {
  const [rows] = await conn.query(`SELECT id, code, label, color FROM product_tags WHERE tenant_id = :tenantId ORDER BY label`, { tenantId });
  return rows;
}
async function findTagByCode(tenantId, code, conn = pool) {
  const [[row]] = await conn.query(`SELECT id FROM product_tags WHERE tenant_id = :tenantId AND code = :code`, { tenantId, code });
  return row || null;
}
async function createTag(tenantId, d, conn = pool) {
  const [r] = await conn.query(
    `INSERT INTO product_tags (tenant_id, code, label, color) VALUES (:tenantId, :code, :label, :color)`,
    { tenantId, code: d.code, label: d.label, color: d.color ?? null }
  );
  return r.insertId;
}
async function setProductTags(tenantId, productId, tagIds, conn = pool) {
  await conn.query(`DELETE FROM product_tag_map WHERE tenant_id = :tenantId AND product_id = :productId`, { tenantId, productId });
  if (tagIds.length) {
    await conn.query(`INSERT INTO product_tag_map (product_id, tag_id, tenant_id) VALUES ?`, [tagIds.map((t) => [productId, t, tenantId])]);
  }
}

// ---------------------------------------------- lectura del menú público
// Devuelve el árbol menú -> categorías -> productos para UNA sucursal, con
// el precio y la disponibilidad YA resueltos por sucursal. No incluye
// productos inactivos ni no disponibles. El filtrado por ventana horaria
// de la categoría lo hace el service (necesita "ahora" en la TZ de la
// sucursal).
async function buildPublicMenu(tenantId, branchId, conn = pool) {
  const [menus] = await conn.query(
    `SELECT id, code, name, sort_order FROM menus
      WHERE tenant_id = :tenantId AND status = 'active' AND deleted_at IS NULL
        AND (branch_id IS NULL OR branch_id = :branchId)
      ORDER BY sort_order, name`,
    { tenantId, branchId }
  );
  if (!menus.length) return [];

  const [cats] = await conn.query(
    `SELECT c.id, c.menu_id, c.code, c.name, c.icon, c.sort_order, c.active_from, c.active_to, c.days_mask
       FROM menu_categories c
       JOIN menus m ON m.id = c.menu_id
      WHERE c.tenant_id = :tenantId AND c.status = 'active' AND c.deleted_at IS NULL
        AND m.status = 'active' AND m.deleted_at IS NULL
        AND (m.branch_id IS NULL OR m.branch_id = :branchId)
      ORDER BY c.sort_order, c.name`,
    { tenantId, branchId }
  );

  const [prods] = await conn.query(
    `SELECT p.id, p.category_id, p.code, p.name, p.description, p.base_price, p.currency,
            p.image_url, p.prep_minutes, p.requires_age_verification, p.sort_order,
            p.track_stock, p.stock_qty,
            o.price AS override_price, o.is_available AS override_available
       FROM products p
       JOIN menu_categories c ON c.id = p.category_id AND c.deleted_at IS NULL AND c.status = 'active'
       JOIN menus m ON m.id = c.menu_id AND m.deleted_at IS NULL AND m.status = 'active'
       LEFT JOIN product_branch_overrides o ON o.product_id = p.id AND o.branch_id = :branchId
      WHERE p.tenant_id = :tenantId AND p.is_active = 1 AND p.deleted_at IS NULL
        AND (m.branch_id IS NULL OR m.branch_id = :branchId)
      ORDER BY p.sort_order, p.name`,
    { tenantId, branchId }
  );
  const productIds = prods.map((p) => p.id);

  let variantsByProduct = new Map();
  let tagsByProduct = new Map();
  let modGroupsByProduct = new Map();
  if (productIds.length) {
    const [variants] = await conn.query(
      `SELECT product_id, code, name, price_delta, prep_minutes_delta, is_default, sort_order
         FROM product_variants
        WHERE tenant_id = :tenantId AND is_active = 1 ORDER BY sort_order, name`,
      { tenantId }
    );
    for (const v of variants) {
      if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
      variantsByProduct.get(v.product_id).push(v);
    }
    const [ptm] = await conn.query(
      `SELECT m.product_id, t.code, t.label, t.color
         FROM product_tag_map m JOIN product_tags t ON t.id = m.tag_id
        WHERE m.tenant_id = :tenantId`,
      { tenantId }
    );
    for (const t of ptm) {
      if (!tagsByProduct.has(t.product_id)) tagsByProduct.set(t.product_id, []);
      tagsByProduct.get(t.product_id).push({ code: t.code, label: t.label, color: t.color });
    }
    const [pmg] = await conn.query(
      `SELECT pmg.product_id, g.code, g.name, g.min_select, g.max_select, g.required, pmg.sort_order
         FROM product_modifier_groups pmg
         JOIN modifier_groups g ON g.id = pmg.group_id AND g.deleted_at IS NULL
        WHERE pmg.tenant_id = :tenantId ORDER BY pmg.sort_order`,
      { tenantId }
    );
    for (const g of pmg) {
      if (!modGroupsByProduct.has(g.product_id)) modGroupsByProduct.set(g.product_id, []);
      modGroupsByProduct.get(g.product_id).push(g);
    }
  }

  const prodsByCat = new Map();
  for (const p of prods) {
    if (!prodsByCat.has(p.category_id)) prodsByCat.set(p.category_id, []);
    prodsByCat.get(p.category_id).push({
      ...p,
      variants: variantsByProduct.get(p.id) || [],
      tags: tagsByProduct.get(p.id) || [],
      modifierGroups: modGroupsByProduct.get(p.id) || [],
    });
  }
  const catsByMenu = new Map();
  for (const c of cats) {
    if (!catsByMenu.has(c.menu_id)) catsByMenu.set(c.menu_id, []);
    catsByMenu.get(c.menu_id).push({ ...c, products: prodsByCat.get(c.id) || [] });
  }
  return menus.map((m) => ({ ...m, categories: catsByMenu.get(m.id) || [] }));
}

module.exports = {
  buildPublicMenu,
  listMenus, findMenu, findMenuByCode, createMenu, updateMenu, softDeleteMenu,
  listCategories, findCategory, findCategoryByCode, createCategory, updateCategory, softDeleteCategory, categoryHasProducts,
  listProducts, findProduct, findProductByCode, createProduct, updateProduct, updateProductBasePrice, softDeleteProduct,
  decrementStock, restoreStock, findStockInfo,
  upsertBranchOverride, listBranchOverrides,
  listVariants, findVariantByCode, createVariant, deleteVariant,
  listModifierGroups, findModifierGroupByCode, createModifierGroup, addModifier,
  setProductModifierGroups, listProductModifierGroups,
  listTags, findTagByCode, createTag, setProductTags,
};
