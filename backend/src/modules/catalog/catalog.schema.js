const { z } = require('zod');

const code = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Sólo minúsculas, números, guión y guión bajo.');
const money = z.coerce.number().nonnegative().max(99999999).multipleOf(0.01, 'Máximo 2 decimales.');
const moneyDelta = z.coerce.number().min(-99999999).max(99999999).multipleOf(0.01, 'Máximo 2 decimales.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:MM.');

const createMenu = z.object({
  code,
  name: z.string().trim().min(2).max(160),
  branchId: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(['active', 'archived']).default('active'),
  sortOrder: z.coerce.number().int().default(0),
});
const updateMenu = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  status: z.enum(['active', 'archived']).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const createCategory = z.object({
  menuId: z.coerce.number().int().positive(),
  code,
  name: z.string().trim().min(2).max(120),
  icon: z.string().trim().max(16).optional(),
  sortOrder: z.coerce.number().int().default(0),
  activeFrom: time.optional(),
  activeTo: time.optional(),
  daysMask: z.coerce.number().int().min(0).max(127).nullable().optional(),
  status: z.enum(['active', 'archived']).default('active'),
});
const updateCategory = createCategory.partial().omit({ menuId: true, code: true });

const createProduct = z.object({
  categoryId: z.coerce.number().int().positive(),
  code,
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).optional(),
  basePrice: money,
  currency: z.string().length(3).default('ARS'),
  imageUrl: z.string().trim().url().max(500).optional(),
  prepMinutes: z.coerce.number().int().min(0).max(600).default(0),
  requiresAgeVerification: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});
// update NO incluye basePrice — el precio va por su propio endpoint (permiso aparte)
const updateProduct = createProduct.partial().omit({ code: true, basePrice: true, currency: true });

const updatePrice = z.object({ basePrice: money });

const branchOverride = z.object({
  branchId: z.coerce.number().int().positive(),
  price: money.nullable().optional(),
  isAvailable: z.boolean().default(true),
});

const createVariant = z.object({
  code,
  name: z.string().trim().min(1).max(120),
  priceDelta: moneyDelta.default(0),
  prepMinutesDelta: z.coerce.number().int().min(-600).max(600).default(0),
  isDefault: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});

const createModifierGroup = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  minSelect: z.coerce.number().int().min(0).max(20).default(0),
  maxSelect: z.coerce.number().int().min(1).max(20).default(1),
  required: z.boolean().default(false),
});
const createModifier = z.object({
  code,
  name: z.string().trim().min(1).max(120),
  priceDelta: moneyDelta.default(0),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});
const setModifierGroups = z.object({ groupIds: z.array(z.coerce.number().int().positive()).default([]) });

const createTag = z.object({
  code,
  label: z.string().trim().min(1).max(60),
  color: z.string().trim().max(16).optional(),
});
const setTags = z.object({ tagIds: z.array(z.coerce.number().int().positive()).default([]) });

module.exports = {
  createMenu, updateMenu,
  createCategory, updateCategory,
  createProduct, updateProduct, updatePrice, branchOverride,
  createVariant,
  createModifierGroup, createModifier, setModifierGroups,
  createTag, setTags,
};
