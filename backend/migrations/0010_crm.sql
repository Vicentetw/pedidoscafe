-- Fase 9 — CRM (ARQUITECTURA_V1 §4.8). Clientes, preferencias e historial de
-- consumo. `crm:view`/`crm:manage` ya estaban sembrados en los roles de
-- sistema desde 0002 (pensados para esta fase) — no hace falta un permiso
-- nuevo.
--
-- `session_participants.customer_id` (reservado desde 0004) y el nuevo
-- `orders.customer_id` son el vínculo: cuando se conoce el cliente se linkea
-- el participante de la mesa y/o se pasa customerId al crear el pedido
-- (mostrador). El historial de un cliente junta ambos caminos.

SET NAMES utf8mb4;

-- ============================================================ customers
CREATE TABLE customers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  code           VARCHAR(40) NULL,
  name           VARCHAR(120) NOT NULL,
  phone          VARCHAR(30) NULL,
  email          VARCHAR(160) NULL,
  birth_date     DATE NULL,
  home_branch_id BIGINT UNSIGNED NULL,
  consent        JSON NULL,             -- { marketing: bool, whatsapp: bool, ... }
  notes          VARCHAR(500) NULL,
  first_seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_order_at  TIMESTAMP NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- NULL no cuenta como duplicado en MySQL: varios clientes sin teléfono o
  -- sin email conviven bien bajo este UNIQUE.
  UNIQUE KEY uq_customers_tenant_phone (tenant_id, phone),
  UNIQUE KEY uq_customers_tenant_email (tenant_id, email),
  KEY idx_customers_tenant_name (tenant_id, name),
  CONSTRAINT fk_customers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_customers_home_branch FOREIGN KEY (home_branch_id) REFERENCES branches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ================================================ customer_preferences
CREATE TABLE customer_preferences (
  customer_id BIGINT UNSIGNED NOT NULL,
  tenant_id   BIGINT UNSIGNED NOT NULL,   -- redundante pero consistente con el resto: toda tabla de negocio filtra por tenant_id sin depender de un JOIN
  `key`       VARCHAR(60) NOT NULL,
  value       VARCHAR(500) NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, `key`),
  CONSTRAINT fk_customer_prefs_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_customer_prefs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================== vínculo con lo que ya existía (Fases 3-4)
ALTER TABLE session_participants
  ADD CONSTRAINT fk_session_participants_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- `orders.customer_id` es nuevo: cubre pedidos de mostrador (sin mesa/
-- participante) y da una única columna para el historial de compra sin
-- depender siempre del join contra session_participants.
ALTER TABLE orders
  ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER participant_id,
  ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  ADD KEY idx_orders_customer (tenant_id, customer_id);
