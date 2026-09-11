-- Fase 11 — Promociones (ARQUITECTURA_V1 §4.8). Primer consumidor real de
-- `customers`/`loyalty_tiers` (Fases 9-10): la condición CUSTOMER_TIER.
-- `promotions:view`/`promotions:manage` ya estaban sembrados en los roles de
-- sistema desde 0002 — no hace falta un permiso nuevo.

SET NAMES utf8mb4;

-- =========================================================== promotions
CREATE TABLE promotions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(40) NOT NULL,
  name        VARCHAR(120) NOT NULL,
  -- Sólo PERCENT/FIXED tienen motor de cálculo en esta fase (ver
  -- promotions.service.js). BOGO/COMBO/FREE_ITEM/HAPPY_HOUR quedan
  -- modeladas (mismo enum que ARQUITECTURA_V1) pero su alta se rechaza
  -- hasta tener un criterio de producto sobre qué ítem puntual regalar/
  -- combear — ver FASE11.md.
  type        ENUM('PERCENT','FIXED','BOGO','COMBO','FREE_ITEM','HAPPY_HOUR') NOT NULL,
  value       DECIMAL(12,2) NULL,     -- % (0-100) si PERCENT, $ si FIXED
  priority    INT NOT NULL DEFAULT 0, -- más bajo = se aplica primero
  stackable   BOOLEAN NOT NULL DEFAULT 0,
  active_from DATETIME NULL,
  active_to   DATETIME NULL,
  status      VARCHAR(12) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE|INACTIVE
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_promotions_tenant_code (tenant_id, code),
  CONSTRAINT fk_promotions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ======================================================= promotion_rules
-- Condiciones AND entre sí: una promoción con varias filas exige TODAS.
CREATE TABLE promotion_rules (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  promotion_id   BIGINT UNSIGNED NOT NULL,
  condition_type ENUM('BRANCH','CATEGORY','PRODUCT','TIME','DAY','MIN_QTY','CUSTOMER_TIER','MIN_AMOUNT') NOT NULL,
  operator       VARCHAR(10) NOT NULL DEFAULT 'EQ',
  value          JSON NOT NULL,
  KEY idx_promotion_rules_promotion (promotion_id),
  CONSTRAINT fk_promotion_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_promotion_rules_promotion FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =================================================== promotion_redemptions
CREATE TABLE promotion_redemptions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  promotion_id   BIGINT UNSIGNED NOT NULL,
  order_id       BIGINT UNSIGNED NOT NULL,
  amount_discounted DECIMAL(12,2) NOT NULL,
  -- Snapshot al momento de aplicar (mismo criterio que order_items.name_snapshot):
  -- si la promoción se edita o desactiva después, el descuento ya aplicado
  -- a este pedido no cambia solo, y recalcularlo al sumar/sacar ítems no
  -- depende de volver a leer `promotions` (que puede haber cambiado).
  code_snapshot     VARCHAR(40) NOT NULL,
  type_snapshot     VARCHAR(12) NOT NULL,
  value_snapshot    DECIMAL(12,2) NULL,
  priority_snapshot INT NOT NULL DEFAULT 0,
  stackable_snapshot BOOLEAN NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Aplicar la MISMA promo dos veces al mismo pedido es un no-op idempotente.
  UNIQUE KEY uq_promo_redemption_order (tenant_id, order_id, promotion_id),
  KEY idx_promo_redemptions_promotion (promotion_id),
  CONSTRAINT fk_promo_redemptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_promo_redemptions_promotion FOREIGN KEY (promotion_id) REFERENCES promotions(id),
  CONSTRAINT fk_promo_redemptions_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
