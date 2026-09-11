-- Fase 2 — Menú / catálogo (ARQUITECTURA_V1 §4.3).
--   menus -> menu_categories -> products
--   products: precio y prep base; override por sucursal (product_branch_overrides)
--   product_variants: deltas de precio / prep
--   modifier_groups / modifiers: extras, con delta de precio
--   product_modifier_groups: qué grupos aplican a cada producto
--   product_tags / product_tag_map: etiquetas (nuevo, popular, sin TACC, ...)
--
-- Regla de oro (ARQUITECTURA_V1 §15): el precio SIEMPRE lo calcula el
-- backend a partir de estas tablas. El front nunca lo envía.
-- Toda clave natural: UNIQUE (tenant_id, ...) — nunca global.

SET NAMES utf8mb4;

-- ============================================================
-- menus  (branch_id NULL = menú global de la empresa)
-- ============================================================
CREATE TABLE menus (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  branch_id  BIGINT UNSIGNED NULL,
  code       VARCHAR(40)  NOT NULL,
  name       VARCHAR(160) NOT NULL,
  status     VARCHAR(24)  NOT NULL DEFAULT 'active',   -- active | archived
  sort_order INT NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  branch_scope BIGINT UNSIGNED AS (COALESCE(branch_id, 0)) STORED,
  UNIQUE KEY uq_menus_tenant_scope_code (tenant_id, branch_scope, code),
  KEY idx_menus_tenant (tenant_id),
  CONSTRAINT fk_menus_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_menus_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id),
  CONSTRAINT fk_menus_created FOREIGN KEY (created_by) REFERENCES app_users(id),
  CONSTRAINT fk_menus_updated FOREIGN KEY (updated_by) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- menu_categories  (ventana horaria opcional + días de semana)
-- ============================================================
CREATE TABLE menu_categories (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  menu_id    BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(48)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  icon       VARCHAR(16)  NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active_from TIME NULL,          -- ventana horaria (menú inteligente, §15)
  active_to   TIME NULL,
  days_mask  TINYINT UNSIGNED NULL,   -- bit0=lunes .. bit6=domingo; NULL = todos
  status     VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_menu_categories_menu_code (tenant_id, menu_id, code),
  KEY idx_menu_categories_menu (menu_id),
  CONSTRAINT fk_menu_categories_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_menu_categories_menu   FOREIGN KEY (menu_id)   REFERENCES menus(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- products
-- ============================================================
CREATE TABLE products (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  category_id   BIGINT UNSIGNED NOT NULL,
  code          VARCHAR(48)  NOT NULL,
  name          VARCHAR(160) NOT NULL,
  description   VARCHAR(1000) NULL,
  base_price    DECIMAL(12,2) NOT NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'ARS',
  image_url     VARCHAR(500) NULL,
  prep_minutes  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  requires_age_verification TINYINT(1) NOT NULL DEFAULT 0,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  sort_order    INT NOT NULL DEFAULT 0,
  created_by    BIGINT UNSIGNED NULL,
  updated_by    BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    TIMESTAMP NULL,
  UNIQUE KEY uq_products_tenant_code (tenant_id, code),
  KEY idx_products_tenant_category (tenant_id, category_id),
  CONSTRAINT fk_products_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenants(id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES menu_categories(id),
  CONSTRAINT fk_products_created  FOREIGN KEY (created_by)  REFERENCES app_users(id),
  CONSTRAINT fk_products_updated  FOREIGN KEY (updated_by)  REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- product_branch_overrides  (precio / disponibilidad por sucursal, §3)
-- ============================================================
CREATE TABLE product_branch_overrides (
  product_id   BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NOT NULL,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  price        DECIMAL(12,2) NULL,        -- NULL = usa products.base_price
  is_available TINYINT(1) NOT NULL DEFAULT 1,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, branch_id),
  KEY idx_pbo_tenant_branch (tenant_id, branch_id),
  CONSTRAINT fk_pbo_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pbo_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id) ON DELETE CASCADE,
  CONSTRAINT fk_pbo_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- product_variants  (tamaño, leche, etc. — deltas)
-- ============================================================
CREATE TABLE product_variants (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  product_id         BIGINT UNSIGNED NOT NULL,
  code               VARCHAR(48)  NOT NULL,
  name               VARCHAR(120) NOT NULL,
  price_delta        DECIMAL(12,2) NOT NULL DEFAULT 0,
  prep_minutes_delta SMALLINT NOT NULL DEFAULT 0,
  is_default         TINYINT(1) NOT NULL DEFAULT 0,
  sort_order         INT NOT NULL DEFAULT 0,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_variants_product_code (tenant_id, product_id, code),
  KEY idx_product_variants_product (product_id),
  CONSTRAINT fk_product_variants_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_product_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- modifier_groups / modifiers  (extras, toppings)
-- ============================================================
CREATE TABLE modifier_groups (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(48)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  min_select TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_select TINYINT UNSIGNED NOT NULL DEFAULT 1,
  required   TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_modifier_groups_tenant_code (tenant_id, code),
  CONSTRAINT fk_modifier_groups_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE modifiers (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  group_id    BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(48)  NOT NULL,
  name        VARCHAR(120) NOT NULL,
  price_delta DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_modifiers_group_code (tenant_id, group_id, code),
  KEY idx_modifiers_group (group_id),
  CONSTRAINT fk_modifiers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_modifiers_group  FOREIGN KEY (group_id)  REFERENCES modifier_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE product_modifier_groups (
  product_id BIGINT UNSIGNED NOT NULL,
  group_id   BIGINT UNSIGNED NOT NULL,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, group_id),
  KEY idx_pmg_group (group_id),
  CONSTRAINT fk_pmg_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pmg_group   FOREIGN KEY (group_id)   REFERENCES modifier_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_pmg_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- product_tags / product_tag_map
-- ============================================================
CREATE TABLE product_tags (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code      VARCHAR(40) NOT NULL,
  label     VARCHAR(60) NOT NULL,
  color     VARCHAR(16) NULL,
  UNIQUE KEY uq_product_tags_tenant_code (tenant_id, code),
  CONSTRAINT fk_product_tags_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE product_tag_map (
  product_id BIGINT UNSIGNED NOT NULL,
  tag_id     BIGINT UNSIGNED NOT NULL,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (product_id, tag_id),
  KEY idx_ptm_tag (tag_id),
  CONSTRAINT fk_ptm_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_ptm_tag     FOREIGN KEY (tag_id)     REFERENCES product_tags(id) ON DELETE CASCADE,
  CONSTRAINT fk_ptm_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
