-- Fase 1 — Foundation. Plataforma, identidad, multi-tenant, RBAC, auditoría,
-- outbox de eventos y configuración por negocio.
--
-- Convenciones (ARQUITECTURA_V1 §18):
--   - InnoDB, utf8mb4_0900_ai_ci, FKs reales.
--   - PK: BIGINT UNSIGNED AUTO_INCREMENT.
--   - Toda tabla de negocio: tenant_id NOT NULL FK -> tenants(id).
--   - Claves naturales: UNIQUE (tenant_id, [branch_scope,] code) — NUNCA global.
--   - branch_scope = COALESCE(branch_id, 0): columna generada para poder
--     tener una única fila "a nivel empresa" (branch_id NULL) y una por
--     sucursal, sin que MySQL trate los NULL como distintos en el UNIQUE.

SET NAMES utf8mb4;

-- ============================================================
-- tenants (empresa) — tabla de plataforma, sin tenant_id
-- ============================================================
CREATE TABLE tenants (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(160) NOT NULL,
  slug       VARCHAR(80)  NOT NULL,
  status     VARCHAR(24)  NOT NULL DEFAULT 'active',  -- active | suspended | closed
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenants_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- app_users (staff / operador de plataforma)
--   tenant_id NULL  => superadmin de plataforma
-- ============================================================
CREATE TABLE app_users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  firebase_uid      VARCHAR(128) NOT NULL,
  email             VARCHAR(190) NOT NULL,
  display_name      VARCHAR(160) NULL,
  tenant_id         BIGINT UNSIGNED NULL,
  default_branch_id BIGINT UNSIGNED NULL,
  is_superadmin     TINYINT(1)   NOT NULL DEFAULT 0,
  status            VARCHAR(24)  NOT NULL DEFAULT 'active',  -- active | disabled
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_app_users_firebase_uid (firebase_uid),
  UNIQUE KEY uq_app_users_tenant_email (tenant_id, email),
  KEY idx_app_users_tenant (tenant_id),
  CONSTRAINT fk_app_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- branches (sucursal)
-- ============================================================
CREATE TABLE branches (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(40)  NOT NULL,
  name        VARCHAR(160) NOT NULL,
  timezone    VARCHAR(64)  NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  address_json JSON        NULL,
  status      VARCHAR(24)  NOT NULL DEFAULT 'active',  -- active | closed
  created_by  BIGINT UNSIGNED NULL,
  updated_by  BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP    NULL,
  UNIQUE KEY uq_branches_tenant_code (tenant_id, code),
  KEY idx_branches_tenant (tenant_id),
  CONSTRAINT fk_branches_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_branches_created FOREIGN KEY (created_by) REFERENCES app_users(id),
  CONSTRAINT fk_branches_updated FOREIGN KEY (updated_by) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE app_users
  ADD CONSTRAINT fk_app_users_default_branch FOREIGN KEY (default_branch_id) REFERENCES branches(id);

-- ============================================================
-- roles + role_permissions
--   tenant_id NULL  => preset de sistema (compartido por todas las empresas)
-- ============================================================
CREATE TABLE roles (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NULL,
  code        VARCHAR(48)  NOT NULL,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_tenant_code (tenant_id, code),
  CONSTRAINT fk_roles_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_permissions (
  role_id    BIGINT UNSIGNED NOT NULL,
  permission VARCHAR(64) NOT NULL,  -- "modulo:accion" (shared/permissions.js)
  PRIMARY KEY (role_id, permission),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- user_roles — roles asignados a un usuario, opcionalmente por sucursal
-- ============================================================
CREATE TABLE user_roles (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  app_user_id  BIGINT UNSIGNED NOT NULL,
  role_id      BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NULL,  -- NULL = toda la empresa
  branch_scope BIGINT UNSIGNED AS (COALESCE(branch_id, 0)) STORED,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_roles (app_user_id, role_id, branch_scope),
  KEY idx_user_roles_role (role_id),
  CONSTRAINT fk_user_roles_user   FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role   FOREIGN KEY (role_id)     REFERENCES roles(id),
  CONSTRAINT fk_user_roles_branch FOREIGN KEY (branch_id)   REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- user_permissions — overrides individuales (ALLOW / DENY)
--   Fase 1: la resolución de permisos los trata como globales al tenant.
--   El branch_scope queda para acotarlos por sucursal más adelante.
-- ============================================================
CREATE TABLE user_permissions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  app_user_id  BIGINT UNSIGNED NOT NULL,
  permission   VARCHAR(64) NOT NULL,
  effect       ENUM('ALLOW','DENY') NOT NULL DEFAULT 'ALLOW',
  branch_id    BIGINT UNSIGNED NULL,
  branch_scope BIGINT UNSIGNED AS (COALESCE(branch_id, 0)) STORED,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_permissions (app_user_id, permission, branch_scope),
  CONSTRAINT fk_user_permissions_user   FOREIGN KEY (app_user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_branch FOREIGN KEY (branch_id)   REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- audit_log (prompt.txt §46)
-- ============================================================
CREATE TABLE audit_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NULL,   -- NULL = acción de plataforma sin empresa
  branch_id     BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_kind    VARCHAR(16) NOT NULL DEFAULT 'system',  -- user | guest | system
  ip            VARCHAR(45) NULL,
  entity_type   VARCHAR(48) NOT NULL,
  entity_id     VARCHAR(64) NOT NULL,
  action        VARCHAR(48) NOT NULL,
  before_json   JSON NULL,
  after_json    JSON NULL,
  reason        VARCHAR(500) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_tenant_entity  (tenant_id, entity_type, entity_id),
  KEY idx_audit_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id)     REFERENCES tenants(id),
  CONSTRAINT fk_audit_actor  FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- domain_events (outbox) — ARQUITECTURA_V1 §2
-- ============================================================
CREATE TABLE domain_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  branch_id     BIGINT UNSIGNED NULL,
  type          VARCHAR(64) NOT NULL,
  payload       JSON NOT NULL,
  occurred_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  dispatched_at TIMESTAMP(3) NULL,
  attempts      INT UNSIGNED NOT NULL DEFAULT 0,
  KEY idx_domain_events_undispatched (dispatched_at, id),
  KEY idx_domain_events_tenant_type  (tenant_id, type),
  CONSTRAINT fk_domain_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- settings — configuración por negocio (prompt.txt §70)
--   branch_id NULL => valor a nivel empresa
-- ============================================================
CREATE TABLE settings (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NULL,
  branch_scope BIGINT UNSIGNED AS (COALESCE(branch_id, 0)) STORED,
  `key`        VARCHAR(80) NOT NULL,
  value        JSON NOT NULL,
  updated_by   BIGINT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_settings (tenant_id, branch_scope, `key`),
  CONSTRAINT fk_settings_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_settings_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id),
  CONSTRAINT fk_settings_updated FOREIGN KEY (updated_by) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
