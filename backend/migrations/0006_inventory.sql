-- Fase 5 — Stock (ARQUITECTURA_V1 §4.4, §8 flujo de stock, §11-12 concurrencia).
--   ingredients -> recipes -> recipe_items          (qué consume cada producto)
--   stock (por branch+ingrediente)                  ← LA FILA que se bloquea con FOR UPDATE
--   stock_movements                                  (ledger append-only)
--   stock_reservations                               (reserva pesimista al confirmar un pedido)
--   suppliers / purchases / purchase_items           (ingreso de stock)
--
-- Disponible = qty_on_hand - qty_reserved. La invariante qty_reserved <=
-- qty_on_hand la garantiza el service dentro de la transacción del submit.

SET NAMES utf8mb4;

CREATE TABLE ingredients (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(48) NOT NULL,
  name       VARCHAR(120) NOT NULL,
  unit       VARCHAR(8) NOT NULL DEFAULT 'unit',   -- g|kg|ml|l|unit
  is_tracked TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_ingredients_tenant_code (tenant_id, code),
  CONSTRAINT fk_ingredients_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Una receta por (producto, variante); variant_id NULL = receta base del
-- producto. La unicidad "una sola receta base" la refuerza el service
-- (MySQL no deja ON DELETE CASCADE sobre una columna que alimente una
-- columna generada, así que no se usa un variant_scope generado).
CREATE TABLE recipes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  variant_id BIGINT UNSIGNED NULL,
  yield_qty  DECIMAL(12,3) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_recipes_product_variant (tenant_id, product_id, variant_id),
  CONSTRAINT fk_recipes_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_recipes_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_recipes_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE recipe_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  recipe_id     BIGINT UNSIGNED NOT NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  qty           DECIMAL(12,3) NOT NULL,
  UNIQUE KEY uq_recipe_items (recipe_id, ingredient_id),
  KEY idx_recipe_items_ingredient (ingredient_id),
  CONSTRAINT fk_recipe_items_tenant     FOREIGN KEY (tenant_id)     REFERENCES tenants(id),
  CONSTRAINT fk_recipe_items_recipe     FOREIGN KEY (recipe_id)     REFERENCES recipes(id) ON DELETE CASCADE,
  CONSTRAINT fk_recipe_items_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stock (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  branch_id     BIGINT UNSIGNED NOT NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  qty_on_hand   DECIMAL(12,3) NOT NULL DEFAULT 0,
  qty_reserved  DECIMAL(12,3) NOT NULL DEFAULT 0,
  reorder_point DECIMAL(12,3) NULL,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stock_branch_ingredient (tenant_id, branch_id, ingredient_id),
  KEY idx_stock_branch (tenant_id, branch_id),
  CONSTRAINT fk_stock_tenant     FOREIGN KEY (tenant_id)     REFERENCES tenants(id),
  CONSTRAINT fk_stock_branch     FOREIGN KEY (branch_id)     REFERENCES branches(id),
  CONSTRAINT fk_stock_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stock_movements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  branch_id     BIGINT UNSIGNED NOT NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  type          VARCHAR(16) NOT NULL,   -- PURCHASE|RESERVE|RELEASE|CONSUME|ADJUST|WASTE|TRANSFER_IN|TRANSFER_OUT
  qty           DECIMAL(12,3) NOT NULL, -- con signo
  ref_type      VARCHAR(24) NULL,
  ref_id        BIGINT UNSIGNED NULL,
  reason        VARCHAR(300) NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_stock_movements_ledger (tenant_id, branch_id, ingredient_id, created_at),
  KEY idx_stock_movements_ref (ref_type, ref_id),
  CONSTRAINT fk_stock_movements_tenant     FOREIGN KEY (tenant_id)     REFERENCES tenants(id),
  CONSTRAINT fk_stock_movements_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id),
  CONSTRAINT fk_stock_movements_actor      FOREIGN KEY (actor_user_id) REFERENCES app_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stock_reservations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  branch_id     BIGINT UNSIGNED NOT NULL,
  order_id      BIGINT UNSIGNED NOT NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  qty           DECIMAL(12,3) NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE|CONSUMED|RELEASED
  expires_at    TIMESTAMP NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_stock_reservations_status_expiry (status, expires_at),
  KEY idx_stock_reservations_order (order_id),
  KEY idx_stock_reservations_stock (tenant_id, branch_id, ingredient_id),
  CONSTRAINT fk_stock_reservations_tenant     FOREIGN KEY (tenant_id)     REFERENCES tenants(id),
  CONSTRAINT fk_stock_reservations_order      FOREIGN KEY (order_id)      REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_stock_reservations_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE suppliers (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(48) NOT NULL,
  name       VARCHAR(160) NOT NULL,
  contact_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_suppliers_tenant_code (tenant_id, code),
  CONSTRAINT fk_suppliers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE purchases (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',  -- DRAFT|RECEIVED
  total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  note        VARCHAR(300) NULL,
  created_by  BIGINT UNSIGNED NULL,
  received_at TIMESTAMP NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_purchases_branch (tenant_id, branch_id, created_at),
  CONSTRAINT fk_purchases_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenants(id),
  CONSTRAINT fk_purchases_branch   FOREIGN KEY (branch_id)   REFERENCES branches(id),
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_purchases_created  FOREIGN KEY (created_by)  REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE purchase_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  purchase_id   BIGINT UNSIGNED NOT NULL,
  ingredient_id BIGINT UNSIGNED NOT NULL,
  qty           DECIMAL(12,3) NOT NULL,
  unit_cost     DECIMAL(12,2) NOT NULL DEFAULT 0,
  KEY idx_purchase_items_purchase (purchase_id),
  CONSTRAINT fk_purchase_items_tenant     FOREIGN KEY (tenant_id)     REFERENCES tenants(id),
  CONSTRAINT fk_purchase_items_purchase   FOREIGN KEY (purchase_id)   REFERENCES purchases(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_items_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
