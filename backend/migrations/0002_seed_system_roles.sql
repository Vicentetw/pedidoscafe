-- Fase 1 — Roles preset del sistema (prompt.txt §4 / ARQUITECTURA_V1 §14).
-- tenant_id NULL + is_system = 1: compartidos por todas las empresas, no se
-- borran ni se editan sus permisos base. Cada empresa puede además crear
-- roles propios (tenant_id = su id) y/o dar overrides por usuario
-- (user_permissions). Permisos = strings "modulo:accion" de
-- shared/permissions.js.
--
-- Idempotente por (tenant_id IS NULL, code) aunque el runner ya evita
-- re-ejecutar el archivo — permite re-sembrar a mano sin duplicar.

SET NAMES utf8mb4;

-- ---------- helper conceptual: lista de TODOS los permisos de negocio ----------
-- (se repite inline en owner / admin_general; el resto usa listas cortas)

-- ============================================================
-- 1. platform_superadmin — operador del SaaS (además del flag is_superadmin)
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'platform_superadmin', 'Superadmin de plataforma', 'Administra empresas, planes y puede operar en nombre de una empresa.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'platform_superadmin');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'platform:manage_tenants' AS permission
  UNION ALL SELECT 'platform:manage_plans'
  UNION ALL SELECT 'platform:impersonate'
) p
WHERE r.tenant_id IS NULL AND r.code = 'platform_superadmin'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 2. owner — dueño: todo dentro de su empresa
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'owner', 'Dueño', 'Acceso total a todos los módulos dentro de su empresa.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'owner');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission UNION ALL SELECT 'catalog:manage' UNION ALL SELECT 'catalog:update_price'
  UNION ALL SELECT 'inventory:view' UNION ALL SELECT 'inventory:adjust' UNION ALL SELECT 'inventory:purchase' UNION ALL SELECT 'inventory:manage_recipes'
  UNION ALL SELECT 'tables:view' UNION ALL SELECT 'tables:open_session' UNION ALL SELECT 'tables:assign_waiter' UNION ALL SELECT 'tables:force_close'
  UNION ALL SELECT 'orders:view' UNION ALL SELECT 'orders:create' UNION ALL SELECT 'orders:amend' UNION ALL SELECT 'orders:cancel' UNION ALL SELECT 'orders:cancel_after_prep' UNION ALL SELECT 'orders:amend_paid' UNION ALL SELECT 'orders:set_priority'
  UNION ALL SELECT 'kitchen:view' UNION ALL SELECT 'kitchen:advance_ticket'
  UNION ALL SELECT 'payments:view' UNION ALL SELECT 'payments:charge' UNION ALL SELECT 'payments:refund' UNION ALL SELECT 'payments:manage_mp_credentials'
  UNION ALL SELECT 'cash:view' UNION ALL SELECT 'cash:open' UNION ALL SELECT 'cash:close' UNION ALL SELECT 'cash:movement'
  UNION ALL SELECT 'reports:view_sales' UNION ALL SELECT 'reports:view_profit' UNION ALL SELECT 'reports:view_audit'
  UNION ALL SELECT 'crm:view' UNION ALL SELECT 'crm:manage'
  UNION ALL SELECT 'loyalty:view' UNION ALL SELECT 'loyalty:adjust'
  UNION ALL SELECT 'promotions:view' UNION ALL SELECT 'promotions:manage'
  UNION ALL SELECT 'staff:view' UNION ALL SELECT 'staff:manage'
  UNION ALL SELECT 'branches:view' UNION ALL SELECT 'branches:manage'
  UNION ALL SELECT 'settings:view' UNION ALL SELECT 'settings:manage'
) p
WHERE r.tenant_id IS NULL AND r.code = 'owner'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 3. admin_general — como el dueño pero sin credenciales de MercadoPago
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'admin_general', 'Administrador general', 'Gestión completa de la empresa, salvo credenciales de cobro.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'admin_general');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission UNION ALL SELECT 'catalog:manage' UNION ALL SELECT 'catalog:update_price'
  UNION ALL SELECT 'inventory:view' UNION ALL SELECT 'inventory:adjust' UNION ALL SELECT 'inventory:purchase' UNION ALL SELECT 'inventory:manage_recipes'
  UNION ALL SELECT 'tables:view' UNION ALL SELECT 'tables:open_session' UNION ALL SELECT 'tables:assign_waiter' UNION ALL SELECT 'tables:force_close'
  UNION ALL SELECT 'orders:view' UNION ALL SELECT 'orders:create' UNION ALL SELECT 'orders:amend' UNION ALL SELECT 'orders:cancel' UNION ALL SELECT 'orders:cancel_after_prep' UNION ALL SELECT 'orders:amend_paid' UNION ALL SELECT 'orders:set_priority'
  UNION ALL SELECT 'kitchen:view' UNION ALL SELECT 'kitchen:advance_ticket'
  UNION ALL SELECT 'payments:view' UNION ALL SELECT 'payments:charge' UNION ALL SELECT 'payments:refund'
  UNION ALL SELECT 'cash:view' UNION ALL SELECT 'cash:open' UNION ALL SELECT 'cash:close' UNION ALL SELECT 'cash:movement'
  UNION ALL SELECT 'reports:view_sales' UNION ALL SELECT 'reports:view_profit' UNION ALL SELECT 'reports:view_audit'
  UNION ALL SELECT 'crm:view' UNION ALL SELECT 'crm:manage'
  UNION ALL SELECT 'loyalty:view' UNION ALL SELECT 'loyalty:adjust'
  UNION ALL SELECT 'promotions:view' UNION ALL SELECT 'promotions:manage'
  UNION ALL SELECT 'staff:view' UNION ALL SELECT 'staff:manage'
  UNION ALL SELECT 'branches:view' UNION ALL SELECT 'branches:manage'
  UNION ALL SELECT 'settings:view' UNION ALL SELECT 'settings:manage'
) p
WHERE r.tenant_id IS NULL AND r.code = 'admin_general'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 4. admin_sucursal — operación completa de UNA sucursal
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'admin_sucursal', 'Administrador de sucursal', 'Operación completa de su sucursal, sin tocar sucursales ni credenciales.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'admin_sucursal');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission UNION ALL SELECT 'catalog:manage' UNION ALL SELECT 'catalog:update_price'
  UNION ALL SELECT 'inventory:view' UNION ALL SELECT 'inventory:adjust' UNION ALL SELECT 'inventory:purchase' UNION ALL SELECT 'inventory:manage_recipes'
  UNION ALL SELECT 'tables:view' UNION ALL SELECT 'tables:open_session' UNION ALL SELECT 'tables:assign_waiter' UNION ALL SELECT 'tables:force_close'
  UNION ALL SELECT 'orders:view' UNION ALL SELECT 'orders:create' UNION ALL SELECT 'orders:amend' UNION ALL SELECT 'orders:cancel' UNION ALL SELECT 'orders:cancel_after_prep' UNION ALL SELECT 'orders:set_priority'
  UNION ALL SELECT 'kitchen:view' UNION ALL SELECT 'kitchen:advance_ticket'
  UNION ALL SELECT 'payments:view' UNION ALL SELECT 'payments:charge' UNION ALL SELECT 'payments:refund'
  UNION ALL SELECT 'cash:view' UNION ALL SELECT 'cash:open' UNION ALL SELECT 'cash:close' UNION ALL SELECT 'cash:movement'
  UNION ALL SELECT 'reports:view_sales' UNION ALL SELECT 'reports:view_profit' UNION ALL SELECT 'reports:view_audit'
  UNION ALL SELECT 'crm:view' UNION ALL SELECT 'crm:manage'
  UNION ALL SELECT 'loyalty:view' UNION ALL SELECT 'loyalty:adjust'
  UNION ALL SELECT 'promotions:view' UNION ALL SELECT 'promotions:manage'
  UNION ALL SELECT 'staff:view'
  UNION ALL SELECT 'branches:view'
  UNION ALL SELECT 'settings:view'
) p
WHERE r.tenant_id IS NULL AND r.code = 'admin_sucursal'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 5. encargado — a cargo del turno
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'encargado', 'Encargado', 'A cargo del turno: mesas, pedidos, cocina, cobros y caja.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'encargado');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission
  UNION ALL SELECT 'inventory:view' UNION ALL SELECT 'inventory:adjust'
  UNION ALL SELECT 'tables:view' UNION ALL SELECT 'tables:open_session' UNION ALL SELECT 'tables:assign_waiter' UNION ALL SELECT 'tables:force_close'
  UNION ALL SELECT 'orders:view' UNION ALL SELECT 'orders:create' UNION ALL SELECT 'orders:amend' UNION ALL SELECT 'orders:cancel' UNION ALL SELECT 'orders:cancel_after_prep' UNION ALL SELECT 'orders:set_priority'
  UNION ALL SELECT 'kitchen:view' UNION ALL SELECT 'kitchen:advance_ticket'
  UNION ALL SELECT 'payments:view' UNION ALL SELECT 'payments:charge' UNION ALL SELECT 'payments:refund'
  UNION ALL SELECT 'cash:view' UNION ALL SELECT 'cash:open' UNION ALL SELECT 'cash:close' UNION ALL SELECT 'cash:movement'
  UNION ALL SELECT 'reports:view_sales'
  UNION ALL SELECT 'crm:view'
  UNION ALL SELECT 'loyalty:view'
  UNION ALL SELECT 'staff:view'
) p
WHERE r.tenant_id IS NULL AND r.code = 'encargado'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 6. cajero
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'cajero', 'Cajero', 'Cobra pedidos y maneja la caja.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'cajero');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission
  UNION ALL SELECT 'tables:view'
  UNION ALL SELECT 'orders:view' UNION ALL SELECT 'orders:create' UNION ALL SELECT 'orders:amend'
  UNION ALL SELECT 'payments:view' UNION ALL SELECT 'payments:charge' UNION ALL SELECT 'payments:refund'
  UNION ALL SELECT 'cash:view' UNION ALL SELECT 'cash:open' UNION ALL SELECT 'cash:close' UNION ALL SELECT 'cash:movement'
  UNION ALL SELECT 'crm:view'
  UNION ALL SELECT 'loyalty:view'
) p
WHERE r.tenant_id IS NULL AND r.code = 'cajero'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 7. mozo (prompt.txt §4: NO precios, NO anular ventas, NO stock, NO rentabilidad)
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'mozo', 'Mozo', 'Ve sus mesas, toma y modifica pedidos, solicita la cuenta.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'mozo');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission
  UNION ALL SELECT 'tables:view' UNION ALL SELECT 'tables:open_session'
  UNION ALL SELECT 'orders:view' UNION ALL SELECT 'orders:create' UNION ALL SELECT 'orders:amend'
  UNION ALL SELECT 'kitchen:view'
  UNION ALL SELECT 'crm:view'
) p
WHERE r.tenant_id IS NULL AND r.code = 'mozo'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 8. cocina  / 9. barra  — separadas por estación, mismos permisos
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'cocina', 'Cocina', 'Ve y avanza los tickets de su estación.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'cocina');

INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'barra', 'Barra', 'Ve y avanza los tickets de su estación.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'barra');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission
  UNION ALL SELECT 'orders:view'
  UNION ALL SELECT 'kitchen:view' UNION ALL SELECT 'kitchen:advance_ticket'
) p
WHERE r.tenant_id IS NULL AND r.code IN ('cocina', 'barra')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 10. stock
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'stock', 'Stock', 'Controla ingredientes, recetas, movimientos y compras.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'stock');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission
  UNION ALL SELECT 'inventory:view' UNION ALL SELECT 'inventory:adjust' UNION ALL SELECT 'inventory:purchase' UNION ALL SELECT 'inventory:manage_recipes'
  UNION ALL SELECT 'reports:view_sales'
  UNION ALL SELECT 'promotions:view'
) p
WHERE r.tenant_id IS NULL AND r.code = 'stock'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 11. compras
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'compras', 'Compras', 'Registra compras a proveedores.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'compras');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'inventory:view' AS permission UNION ALL SELECT 'inventory:purchase'
  UNION ALL SELECT 'reports:view_sales'
) p
WHERE r.tenant_id IS NULL AND r.code = 'compras'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 12. contabilidad
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'contabilidad', 'Contabilidad', 'Ve pagos, caja y reportes de ventas y rentabilidad.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'contabilidad');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'payments:view' AS permission
  UNION ALL SELECT 'cash:view'
  UNION ALL SELECT 'reports:view_sales' UNION ALL SELECT 'reports:view_profit'
  UNION ALL SELECT 'loyalty:view'
) p
WHERE r.tenant_id IS NULL AND r.code = 'contabilidad'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 13. auditor — sólo lectura, transversal
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'auditor', 'Auditor', 'Sólo lectura de todos los módulos, incluido el registro de auditoría.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'auditor');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission
  UNION ALL SELECT 'inventory:view'
  UNION ALL SELECT 'tables:view'
  UNION ALL SELECT 'orders:view'
  UNION ALL SELECT 'kitchen:view'
  UNION ALL SELECT 'payments:view'
  UNION ALL SELECT 'cash:view'
  UNION ALL SELECT 'reports:view_sales' UNION ALL SELECT 'reports:view_profit' UNION ALL SELECT 'reports:view_audit'
  UNION ALL SELECT 'crm:view'
  UNION ALL SELECT 'loyalty:view'
  UNION ALL SELECT 'promotions:view'
) p
WHERE r.tenant_id IS NULL AND r.code = 'auditor'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

-- ============================================================
-- 14. soporte — plataforma, lectura acotada al operar en nombre de una empresa
-- ============================================================
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT NULL, 'soporte', 'Soporte', 'Lectura acotada para asistir a una empresa.', 1
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'soporte');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'catalog:view' AS permission
  UNION ALL SELECT 'tables:view'
  UNION ALL SELECT 'orders:view'
  UNION ALL SELECT 'payments:view'
  UNION ALL SELECT 'reports:view_sales' UNION ALL SELECT 'reports:view_audit'
) p
WHERE r.tenant_id IS NULL AND r.code = 'soporte'
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);
