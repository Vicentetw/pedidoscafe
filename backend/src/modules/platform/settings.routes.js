const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const { ValidationError } = require('../../errors');
const { writeAudit } = require('../../audit/audit');
const repo = require('./settings.repository');

// Configuración por negocio (prompt.txt §70). Claves conocidas con su
// validación; el resto se rechaza para no llenar la tabla de basura.
// Todas opcionales — si no hay fila, el módulo que la consume usa su default.
const KEYS = {
  'orders.reservation_ttl_minutes': z.number().int().min(1).max(240),
  'orders.abandon_timeout_minutes': z.number().int().min(1).max(240),
  'tips.mode': z.enum(['off', 'fixed', 'percent', 'free']),
  'tips.percent_options': z.array(z.number().min(0).max(100)).max(6),
  'loyalty.points_per_amount': z.number().min(0),
  'loyalty.points_expire_days': z.number().int().min(0),
  'alcohol.min_age': z.number().int().min(0).max(30),
  'cancellation.free_window_minutes': z.number().int().min(0).max(120),
  'currency': z.string().length(3),
  // Modo de pedido "cada uno lo suyo" — oculto por defecto (Fase post-roadmap,
  // pedido en la aceptación): sin esta fila (o en false), la mesa sólo
  // ofrece un pedido único para todos. tables.service.js lo lee para
  // decidir si mostrar la opción al comensal Y para rechazarla server-side
  // si alguien la manda igual sin tenerla habilitada.
  'orders.allow_individual_payment': z.boolean(),
};

const router = express.Router();
router.use(requireTenantId);

router.get(
  '/',
  requirePermission('settings:view'),
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    res.json({ data: await repo.getAll(req.tenantId, branchId), knownKeys: Object.keys(KEYS) });
  })
);

router.put(
  '/:key',
  requirePermission('settings:manage'),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    const validator = KEYS[key];
    if (!validator) throw new ValidationError(`"${key}" no es una clave de configuración conocida.`);
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;

    const parsed = z.object({ value: validator }).parse(req.body);
    const before = await repo.get(req.tenantId, key, branchId);
    await repo.set(req.tenantId, key, parsed.value, { branchId, updatedBy: req.appUser?.id });
    await writeAudit({
      req,
      tenantId: req.tenantId,
      branchId,
      entityType: 'setting',
      entityId: key,
      action: 'update',
      before: { value: before },
      after: { value: parsed.value },
    });
    res.json({ key, value: parsed.value, branchId });
  })
);

module.exports = router;
