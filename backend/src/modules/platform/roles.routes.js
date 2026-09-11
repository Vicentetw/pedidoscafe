const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../../http/asyncHandler');
const { requireTenantId, requirePermission } = require('../../auth/appUserMiddleware');
const { NotFoundError, ConflictError, ForbiddenError } = require('../../errors');
const { isValidPermission, MODULES } = require('../../../../shared/permissions');
const { writeAudit } = require('../../audit/audit');
const repo = require('./roles.repository');

// Roles: presets de sistema (solo lectura) + roles propios de la empresa.
// Gestionar roles requiere staff:manage.
const router = express.Router();
router.use(requireTenantId);

const permsSchema = z
  .array(z.string())
  .refine((arr) => arr.every(isValidPermission), { message: 'Contiene un permiso que no existe en el catálogo.' });

const createRole = z.object({
  code: z.string().trim().min(2).max(48).regex(/^[a-z0-9_]+$/, 'Sólo minúsculas, números y guión bajo.'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(255).optional(),
  permissions: permsSchema.default([]),
});
const updateRole = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(255).optional(),
  permissions: permsSchema.optional(),
});

// Catálogo de permisos — lo usa la pantalla de Roles del frontend.
router.get(
  '/permissions',
  requirePermission('staff:view'),
  (req, res) => res.json({ modules: MODULES })
);

router.get(
  '/',
  requirePermission('staff:view'),
  asyncHandler(async (req, res) => {
    res.json({ data: await repo.listForTenant(req.tenantId) });
  })
);

router.post(
  '/',
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const input = createRole.parse(req.body);
    if (await repo.findTenantRoleByCode(req.tenantId, input.code)) {
      throw new ConflictError('Ya tenés un rol con ese código.');
    }
    const id = await repo.createTenantRole(req.tenantId, input);
    await writeAudit({ req, tenantId: req.tenantId, entityType: 'role', entityId: id, action: 'create', after: input });
    res.status(201).json(await repo.findTenantRole(req.tenantId, id));
  })
);

router.patch(
  '/:id',
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const target = await repo.findAssignable(req.tenantId, id);
    if (!target) throw new NotFoundError('Ese rol no existe.');
    if (target.is_system) throw new ForbiddenError('Los roles del sistema no se editan. Creá uno propio.');
    if (target.tenant_id == null) throw new ForbiddenError('No podés editar un rol de otra empresa.');

    const patch = updateRole.parse(req.body);
    const before = await repo.findTenantRole(req.tenantId, id);
    await repo.updateTenantRole(req.tenantId, id, patch);
    if (patch.permissions) await repo.replacePermissions(id, patch.permissions);
    await writeAudit({ req, tenantId: req.tenantId, entityType: 'role', entityId: id, action: 'update', before, after: patch });
    res.json(await repo.findTenantRole(req.tenantId, id));
  })
);

router.delete(
  '/:id',
  requirePermission('staff:manage'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const target = await repo.findAssignable(req.tenantId, id);
    if (!target) throw new NotFoundError('Ese rol no existe.');
    if (target.is_system || target.tenant_id == null) throw new ForbiddenError('No podés borrar un rol del sistema.');
    const inUse = await repo.countUsersWithRole(id);
    if (inUse > 0) {
      throw new ConflictError(`Hay ${inUse} usuario(s) con este rol. Reasignalos antes de borrarlo.`);
    }
    await repo.deleteTenantRole(req.tenantId, id);
    await writeAudit({ req, tenantId: req.tenantId, entityType: 'role', entityId: id, action: 'delete' });
    res.status(204).end();
  })
);

module.exports = router;
