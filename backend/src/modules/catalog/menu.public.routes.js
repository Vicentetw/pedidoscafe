const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../../http/asyncHandler');
const tenantRepo = require('../platform/tenants.repository');
const { NotFoundError } = require('../../errors');
const svc = require('./catalog.service');

// Superficie PÚBLICA del menú — sin login (montada bajo /api/public, que
// salta las 3 capas de identidad). El tenant se resuelve por slug en la
// URL. En la Fase 3 el menú se sirve además a partir del token de sesión
// de mesa (que ya trae tenant + branch), pero este endpoint por slug
// queda para el menú "de vidriera".
const router = express.Router();

async function resolveTenantId(slug) {
  const t = await tenantRepo.findBySlug(slug);
  if (!t) throw new NotFoundError('No se encontró ese local.');
  return t.id;
}

// GET /api/public/menu/:tenantSlug/:branchCode
router.get(
  '/:tenantSlug/:branchCode',
  asyncHandler(async (req, res) => {
    const tenantId = await resolveTenantId(req.params.tenantSlug);
    res.json(await svc.getPublicMenu(tenantId, req.params.branchCode));
  })
);

// POST /api/public/menu/:tenantSlug/:branchCode/price
// El precio SIEMPRE lo calcula el backend a partir de códigos (mandatory
// case #4: si el body trae un "price"/"unitPrice", se ignora).
const priceBody = z.object({
  productCode: z.string().trim().min(1).max(48),
  variantCode: z.string().trim().min(1).max(48).nullable().optional(),
  modifierCodes: z.array(z.string().trim().min(1).max(48)).max(20).default([]),
  qty: z.coerce.number().int().min(1).max(99).default(1),
});

router.post(
  '/:tenantSlug/:branchCode/price',
  asyncHandler(async (req, res) => {
    const tenantId = await resolveTenantId(req.params.tenantSlug);
    const input = priceBody.parse(req.body); // NO lee price/unitPrice del body
    res.json(await svc.priceLinePreview(tenantId, req.params.branchCode, input));
  })
);

module.exports = router;
