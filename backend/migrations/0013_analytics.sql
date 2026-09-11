-- Fase 12 — Inteligencia / analítica (ARQUITECTURA_V1 §4.11: "al inicio,
-- consultas directas"). El dashboard de esta fase lee DIRECTO de
-- orders/order_items/refunds — siempre exacto, sin nada que invalidar.
-- Estas dos tablas son el esquema que pide la arquitectura para cuando haga
-- falta escalar a algo pre-agregado; existen y se pueden poblar
-- (`POST /api/analytics/rollup/recompute`), pero no son el camino principal
-- todavía. `reports:view_sales`/`reports:view_profit`/`reports:view_audit`
-- ya estaban sembrados en los roles de sistema desde 0002.

SET NAMES utf8mb4;

CREATE TABLE daily_sales_rollup (
  tenant_id   BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  date        DATE NOT NULL,
  orders_count INT UNSIGNED NOT NULL DEFAULT 0,
  gross       DECIMAL(14,2) NOT NULL DEFAULT 0,  -- subtotal, antes de descuentos
  discounts   DECIMAL(14,2) NOT NULL DEFAULT 0,
  net         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- lo efectivamente cobrado (gross - discounts)
  tips        DECIMAL(14,2) NOT NULL DEFAULT 0,
  refunds     DECIMAL(14,2) NOT NULL DEFAULT 0,
  avg_ticket  DECIMAL(14,2) NOT NULL DEFAULT 0,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, branch_id, date),
  CONSTRAINT fk_daily_rollup_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_daily_rollup_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE product_sales_rollup (
  tenant_id  BIGINT UNSIGNED NOT NULL,
  branch_id  BIGINT UNSIGNED NOT NULL,
  date       DATE NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  qty        DECIMAL(14,3) NOT NULL DEFAULT 0,
  gross      DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- margin_est de ARQUITECTURA_V1 queda afuera: requiere un método de
  -- costeo (FIFO/promedio/último precio) que todavía no está definido —
  -- purchase_items.unit_cost es por compra, no hay "costo actual" del
  -- ingrediente. Inventar un método sería adivinar. Ver FASE12.md.
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, branch_id, date, product_id),
  CONSTRAINT fk_product_rollup_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_product_rollup_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
