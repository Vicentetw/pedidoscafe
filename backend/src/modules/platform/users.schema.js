const { z } = require('zod');

const roleAssignment = z.object({
  roleId: z.coerce.number().int().positive(),
  branchId: z.coerce.number().int().positive().nullable().optional(),
});

const inviteUser = z.object({
  email: z.string().trim().toLowerCase().email().max(190),
  displayName: z.string().trim().max(160).optional(),
  defaultBranchId: z.coerce.number().int().positive().nullable().optional(),
  roles: z.array(roleAssignment).default([]),
});

const updateUser = z.object({
  displayName: z.string().trim().max(160).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  defaultBranchId: z.coerce.number().int().positive().nullable().optional(),
  roles: z.array(roleAssignment).optional(),
});

module.exports = { inviteUser, updateUser, roleAssignment };
