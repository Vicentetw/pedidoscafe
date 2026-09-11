const repo = require('./catalog.repository');
const branchRepo = require('../platform/branches.repository');
const { priceLine, fromCents, toCents } = require('./pricing');
const { withTransaction } = require('../../withTransaction');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { writeAudit } = require('../../audit/audit');

const actorOf = (req) => req?.appUser?.id ?? null;

// ============================================================ menús
async function listMenus(tenantId) {
  return repo.listMenus(tenantId);
}
async function createMenu(tenantId, input, req) {
  if (input.branchId && !(await branchRepo.findById(tenantId, input.branchId))) {
    throw new ValidationError('Esa sucursal no existe en tu empresa.');
  }
  if (await repo.findMenuByCode(tenantId, input.branchId ?? null, input.code)) {
    throw new ConflictError('Ya existe un menú con ese código para ese alcance.');
  }
  const id = await repo.createMenu(tenantId, input, actorOf(req));
  await writeAudit({ req, tenantId, entityType: 'menu', entityId: id, action: 'create', after: input });
  return repo.findMenu(tenantId, id);
}
async function updateMenu(tenantId, id, patch, req) {
  const before = await repo.findMenu(tenantId, id);
  if (!before) throw new NotFoundError('Ese menú no existe.');
  await repo.updateMenu(tenantId, id, patch, actorOf(req));
  const after = await repo.findMenu(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'menu', entityId: id, action: 'update', before, after });
  return after;
}
async function deleteMenu(tenantId, id, req) {
  const before = await repo.findMenu(tenantId, id);
  if (!before) throw new NotFoundError('Ese menú no existe.');
  await repo.softDeleteMenu(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'menu', entityId: id, action: 'delete', before });
}

// ======================================================= categorías
async function listCategories(tenantId, menuId) {
  if (!(await repo.findMenu(tenantId, menuId))) throw new NotFoundError('Ese menú no existe.');
  return repo.listCategories(tenantId, menuId);
}
async function createCategory(tenantId, input, req) {
  if (!(await repo.findMenu(tenantId, input.menuId))) throw new ValidationError('Ese menú no existe en tu empresa.');
  if (await repo.findCategoryByCode(tenantId, input.menuId, input.code)) {
    throw new ConflictError('Ya existe una categoría con ese código en ese menú.');
  }
  if (input.activeFrom && input.activeTo && input.activeFrom >= input.activeTo) {
    throw new ValidationError('El horario "desde" debe ser anterior al "hasta".');
  }
  const id = await repo.createCategory(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'menu_category', entityId: id, action: 'create', after: input });
  return repo.findCategory(tenantId, id);
}
async function updateCategory(tenantId, id, patch, req) {
  const before = await repo.findCategory(tenantId, id);
  if (!before) throw new NotFoundError('Esa categoría no existe.');
  await repo.updateCategory(tenantId, id, patch);
  const after = await repo.findCategory(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'menu_category', entityId: id, action: 'update', before, after });
  return after;
}
async function deleteCategory(tenantId, id, req) {
  const before = await repo.findCategory(tenantId, id);
  if (!before) throw new NotFoundError('Esa categoría no existe.');
  if (await repo.categoryHasProducts(tenantId, id)) {
    throw new ConflictError('La categoría tiene productos. Movelos o eliminalos antes.');
  }
  await repo.softDeleteCategory(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'menu_category', entityId: id, action: 'delete', before });
}

// ========================================================= productos
function shapeProduct(p, overrides = []) {
  return { ...p, requires_age_verification: !!p.requires_age_verification, is_active: !!p.is_active, branchOverrides: overrides };
}
async function listProducts(tenantId, query) {
  return (await repo.listProducts(tenantId, query)).map((p) => shapeProduct(p));
}
async function getProduct(tenantId, id) {
  const p = await repo.findProduct(tenantId, id);
  if (!p) throw new NotFoundError('Ese producto no existe.');
  const [overrides, variants, modGroups] = await Promise.all([
    repo.listBranchOverrides(tenantId, id),
    repo.listVariants(tenantId, id),
    repo.listProductModifierGroups(tenantId, id),
  ]);
  return { ...shapeProduct(p, overrides), variants, modifierGroups: modGroups };
}
async function createProduct(tenantId, input, req) {
  if (!(await repo.findCategory(tenantId, input.categoryId))) {
    throw new ValidationError('Esa categoría no existe en tu empresa.');
  }
  if (await repo.findProductByCode(tenantId, input.code)) {
    throw new ConflictError('Ya existe un producto con ese código.');
  }
  const id = await repo.createProduct(tenantId, input, actorOf(req));
  await writeAudit({ req, tenantId, entityType: 'product', entityId: id, action: 'create', after: input });
  return getProduct(tenantId, id);
}
async function updateProduct(tenantId, id, patch, req) {
  const before = await repo.findProduct(tenantId, id);
  if (!before) throw new NotFoundError('Ese producto no existe.');
  if (patch.categoryId && !(await repo.findCategory(tenantId, patch.categoryId))) {
    throw new ValidationError('Esa categoría no existe en tu empresa.');
  }
  await repo.updateProduct(tenantId, id, patch, actorOf(req));
  const after = await repo.findProduct(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'product', entityId: id, action: 'update', before, after });
  return getProduct(tenantId, id);
}
// endpoint separado: exige catalog:update_price y audita el cambio de precio
async function updateProductPrice(tenantId, id, basePrice, req) {
  const before = await repo.findProduct(tenantId, id);
  if (!before) throw new NotFoundError('Ese producto no existe.');
  await repo.updateProductBasePrice(tenantId, id, basePrice, actorOf(req));
  const after = await repo.findProduct(tenantId, id);
  await writeAudit({
    req, tenantId, entityType: 'product', entityId: id, action: 'update_price',
    before: { base_price: before.base_price }, after: { base_price: after.base_price },
  });
  return after;
}
async function deleteProduct(tenantId, id, req) {
  const before = await repo.findProduct(tenantId, id);
  if (!before) throw new NotFoundError('Ese producto no existe.');
  await repo.softDeleteProduct(tenantId, id);
  await writeAudit({ req, tenantId, entityType: 'product', entityId: id, action: 'delete', before });
}
async function setBranchOverride(tenantId, productId, input, req) {
  if (!(await repo.findProduct(tenantId, productId))) throw new NotFoundError('Ese producto no existe.');
  if (!(await branchRepo.findById(tenantId, input.branchId))) throw new ValidationError('Esa sucursal no existe en tu empresa.');
  await repo.upsertBranchOverride(tenantId, productId, input.branchId, input);
  await writeAudit({ req, tenantId, branchId: input.branchId, entityType: 'product', entityId: productId, action: 'branch_override', after: input });
  return repo.listBranchOverrides(tenantId, productId);
}

// ===================================== variantes / modificadores / tags
async function addVariant(tenantId, productId, input, req) {
  if (!(await repo.findProduct(tenantId, productId))) throw new NotFoundError('Ese producto no existe.');
  if (await repo.findVariantByCode(tenantId, productId, input.code)) throw new ConflictError('Ya existe una variante con ese código.');
  const id = await repo.createVariant(tenantId, productId, input);
  await writeAudit({ req, tenantId, entityType: 'product_variant', entityId: id, action: 'create', after: { productId, ...input } });
  return repo.listVariants(tenantId, productId);
}
async function removeVariant(tenantId, productId, id, req) {
  await repo.deleteVariant(tenantId, productId, id);
  await writeAudit({ req, tenantId, entityType: 'product_variant', entityId: id, action: 'delete' });
}
async function listModifierGroups(tenantId) {
  return repo.listModifierGroups(tenantId);
}
async function createModifierGroup(tenantId, input, req) {
  if (input.minSelect > input.maxSelect) throw new ValidationError('"Mínimo" no puede ser mayor que "máximo".');
  if (await repo.findModifierGroupByCode(tenantId, input.code)) throw new ConflictError('Ya existe un grupo con ese código.');
  const id = await repo.createModifierGroup(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'modifier_group', entityId: id, action: 'create', after: input });
  return id;
}
async function addModifier(tenantId, groupId, input, req) {
  const id = await repo.addModifier(tenantId, groupId, input);
  await writeAudit({ req, tenantId, entityType: 'modifier', entityId: id, action: 'create', after: { groupId, ...input } });
  return id;
}
async function setProductModifierGroups(tenantId, productId, groupIds, req) {
  if (!(await repo.findProduct(tenantId, productId))) throw new NotFoundError('Ese producto no existe.');
  await withTransaction((conn) => repo.setProductModifierGroups(tenantId, productId, groupIds, conn));
  await writeAudit({ req, tenantId, entityType: 'product', entityId: productId, action: 'set_modifier_groups', after: { groupIds } });
}
async function listTags(tenantId) {
  return repo.listTags(tenantId);
}
async function createTag(tenantId, input, req) {
  if (await repo.findTagByCode(tenantId, input.code)) throw new ConflictError('Ya existe una etiqueta con ese código.');
  const id = await repo.createTag(tenantId, input);
  await writeAudit({ req, tenantId, entityType: 'product_tag', entityId: id, action: 'create', after: input });
  return id;
}
async function setProductTags(tenantId, productId, tagIds, req) {
  if (!(await repo.findProduct(tenantId, productId))) throw new NotFoundError('Ese producto no existe.');
  await withTransaction((conn) => repo.setProductTags(tenantId, productId, tagIds, conn));
  await writeAudit({ req, tenantId, entityType: 'product', entityId: productId, action: 'set_tags', after: { tagIds } });
}

// ================================================== MENÚ PÚBLICO (comensal)
// Hora local de la sucursal como "HH:MM" + día de semana (0=lunes).
function nowInBranch(tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'America/Argentina/Buenos_Aires',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const days = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { hhmm: `${parts.hour}:${parts.minute}`, weekday: days[parts.weekday] ?? 0 };
}

function categoryActiveNow(cat, now) {
  if (cat.days_mask != null && !((cat.days_mask >> now.weekday) & 1)) return false;
  if (cat.active_from && cat.active_to) {
    const f = String(cat.active_from).slice(0, 5);
    const t = String(cat.active_to).slice(0, 5);
    if (now.hhmm < f || now.hhmm >= t) return false;
  }
  return true;
}

function publicProductView(p, stockRemaining = null) {
  const overridePrice = p.override_price;
  const overrideAvailable = p.override_available;
  const displayPriceCents = overridePrice != null ? toCents(overridePrice) : toCents(p.base_price);
  const variants = (p.variants || []).map((v) => ({
    code: v.code,
    name: v.name,
    priceDelta: fromCents(toCents(v.price_delta)),
    price: fromCents(displayPriceCents + toCents(v.price_delta)),
    isDefault: !!v.is_default,
  }));
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    currency: p.currency,
    price: fromCents(displayPriceCents),
    available: (overrideAvailable == null ? true : overrideAvailable !== 0) && (stockRemaining == null || stockRemaining > 0),
    stockRemaining: stockRemaining == null ? null : stockRemaining,
    prepMinutes: p.prep_minutes + 0,
    requiresAgeVerification: !!p.requires_age_verification,
    imageUrl: p.image_url,
    tags: p.tags || [],
    variants,
    modifierGroups: (p.modifierGroups || []).map((g) => ({
      code: g.code, name: g.name, minSelect: g.min_select, maxSelect: g.max_select, required: !!g.required,
    })),
  };
}

async function getPublicMenu(tenantId, branchCode) {
  const branch = await resolveBranchByCode(tenantId, branchCode);
  const tree = await repo.buildPublicMenu(tenantId, branch.id);
  const now = nowInBranch(branch.timezone);

  // Disponibilidad por stock (Fase 5). null = sin receta / sin límite.
  const productIds = tree.flatMap((m) => m.categories).flatMap((c) => c.products).map((p) => p.id);
  const stockService = require('../inventory/stock.service');
  const availMap = await stockService.availabilityForProducts(tenantId, branch.id, productIds);

  const menus = tree
    .map((m) => ({
      code: m.code,
      name: m.name,
      categories: m.categories
        .filter((c) => categoryActiveNow(c, now))
        .map((c) => ({
          code: c.code,
          name: c.name,
          icon: c.icon,
          products: c.products
            .filter((p) => p.override_available !== 0)
            .map((p) => publicProductView(p, availMap.get(p.id))),
        }))
        .filter((c) => c.products.length),
    }))
    .filter((m) => m.categories.length);

  return { branch: { code: branch.code, name: branch.name }, menus };
}

// branchRepo no tiene un "por código con todos los campos"; se hace acá.
const pool = require('../../db');
async function resolveBranchByCode(tenantId, code) {
  const [[row]] = await pool.query(
    `SELECT id, code, name, timezone FROM branches
      WHERE tenant_id = :tenantId AND code = :code AND deleted_at IS NULL AND status = 'active'`,
    { tenantId, code }
  );
  if (!row) throw new NotFoundError('No se encontró esa sucursal.');
  return row;
}

// Precio de una línea, resuelto SÓLO desde ids/códigos (mandatory case #4:
// el cliente no puede fijar el precio).
async function priceLinePreview(tenantId, branchCode, { productCode, variantCode = null, modifierCodes = [], qty = 1 }) {
  const branch = await resolveBranchByCode(tenantId, branchCode);
  const [[product]] = await pool.query(
    `SELECT id, base_price, currency FROM products
      WHERE tenant_id = :tenantId AND code = :code AND is_active = 1 AND deleted_at IS NULL`,
    { tenantId, code: productCode }
  );
  if (!product) throw new NotFoundError('Ese producto no está disponible.');

  const [[override]] = await pool.query(
    `SELECT price, is_available FROM product_branch_overrides WHERE product_id = :pid AND branch_id = :bid`,
    { pid: product.id, bid: branch.id }
  );
  if (override && override.is_available === 0) throw new ConflictError('Ese producto no está disponible en esta sucursal.');

  let variant = null;
  if (variantCode) {
    const [[v]] = await pool.query(
      `SELECT price_delta FROM product_variants
        WHERE tenant_id = :tenantId AND product_id = :pid AND code = :code AND is_active = 1`,
      { tenantId, pid: product.id, code: variantCode }
    );
    if (!v) throw new ValidationError('Esa variante no existe.');
    variant = v;
  }

  let modifiers = [];
  if (modifierCodes.length) {
    const [rows] = await pool.query(
      `SELECT m.code, m.price_delta FROM modifiers m
         JOIN product_modifier_groups pmg ON pmg.group_id = m.group_id AND pmg.product_id = :pid
        WHERE m.tenant_id = :tenantId AND m.is_active = 1`,
      { tenantId, pid: product.id }
    );
    const allowed = new Map(rows.map((r) => [r.code, r]));
    for (const c of modifierCodes) {
      if (!allowed.has(c)) throw new ValidationError(`El extra "${c}" no aplica a este producto.`);
      modifiers.push(allowed.get(c));
    }
  }

  const priced = priceLine({
    product,
    branchOverridePrice: override ? override.price : null,
    variant,
    modifiers,
    qty,
  });
  return {
    productCode,
    variantCode,
    modifierCodes,
    qty: Math.max(1, Math.trunc(qty)),
    ...priced,
  };
}

module.exports = {
  listMenus, createMenu, updateMenu, deleteMenu,
  listCategories, createCategory, updateCategory, deleteCategory,
  listProducts, getProduct, createProduct, updateProduct, updateProductPrice, deleteProduct, setBranchOverride,
  addVariant, removeVariant,
  listModifierGroups, createModifierGroup, addModifier, setProductModifierGroups,
  listTags, createTag, setProductTags,
  getPublicMenu, priceLinePreview,
};
