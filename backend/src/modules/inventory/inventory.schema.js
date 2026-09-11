const { z } = require('zod');

const code = z.string().trim().min(1).max(48).regex(/^[a-z0-9][a-z0-9_-]*$/, 'Sólo minúsculas, números, guión y guión bajo.');
const qty = z.coerce.number().positive().max(1e9).multipleOf(0.001, 'Máximo 3 decimales.');
const money = z.coerce.number().nonnegative().max(1e8).multipleOf(0.01);

const createIngredient = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'unit']).default('unit'),
  isTracked: z.boolean().default(true),
});
const updateIngredient = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  unit: z.enum(['g', 'kg', 'ml', 'l', 'unit']).optional(),
  isTracked: z.boolean().optional(),
});

const setRecipe = z.object({
  yieldQty: z.coerce.number().positive().max(1e6).default(1),
  items: z.array(z.object({ ingredientCode: code, qty })).min(1).max(60),
});

const adjustStock = z.object({
  ingredientCode: code,
  newOnHand: z.coerce.number().nonnegative().max(1e9).multipleOf(0.001),
  waste: z.boolean().default(false),
  reason: z.string().trim().max(300).optional(),
});
const setReorderPoint = z.object({ ingredientCode: code, value: z.coerce.number().nonnegative().max(1e9).nullable() });

const createPurchase = z.object({
  supplierId: z.coerce.number().int().positive().nullable().optional(),
  note: z.string().trim().max(300).optional(),
  items: z.array(z.object({ ingredientCode: code, qty, unitCost: money.default(0) })).min(1).max(200),
});
const createSupplier = z.object({ code, name: z.string().trim().min(2).max(160) });

module.exports = { createIngredient, updateIngredient, setRecipe, adjustStock, setReorderPoint, createPurchase, createSupplier };
