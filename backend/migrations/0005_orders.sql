-- Fase 4 — Pedidos y cocina (ARQUITECTURA_V1 §4.6, §5 máquina de estados de Order).
--   orders -> order_items -> order_item_modifiers      (con SNAPSHOT de precio)
--   order_events                                       (log de la máquina de estados)
--   kitchen_stations / product_station_routing         (ruteo por estación)
--   kitchen_tickets / kitchen_ticket_items             (KDS)
--
-- El precio de cada línea lo calcula el backend desde el catálogo y se
-- CONGELA en order_items / order_item_modifiers: un cambio de precio
-- posterior no altera un pedido ya cargado.
-- Eje operativo (status) y eje de pago (payment_status) son INDEPENDIENTES.

SET NAMES utf8mb4;

-- ============================================================ orders
CREATE TABLE orders (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id      CHAR(26) NOT NULL,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  branch_id      BIGINT UNSIGNED NOT NULL,
  session_id     BIGINT UNSIGNED NULL,           -- NULL = mostrador / retiro
  participant_id BIGINT UNSIGNED NULL,           -- quién pidió (mesa)
  channel        VARCHAR(12) NOT NULL DEFAULT 'TABLE',   -- TABLE|COUNTER|TAKEAWAY|DELIVERY
  status         VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  payment_status VARCHAR(16) NOT NULL DEFAULT 'UNPAID',  -- UNPAID|PARTIALLY_PAID|PAID|REFUNDED
  priority       VARCHAR(12) NOT NULL DEFAULT 'NORMAL',  -- NORMAL|URGENT|VIP|LATE
  subtotal       DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_total      DECIMAL(12,2) NOT NULL DEFAULT 0,
  tip_total      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total          DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency       CHAR(3) NOT NULL DEFAULT 'ARS',
  note           VARCHAR(500) NULL,
  created_by_kind VARCHAR(12) NOT NULL DEFAULT 'guest',  -- guest|staff
  created_by     BIGINT UNSIGNED NULL,
  ordered_at     TIMESTAMP NULL,
  accepted_at    TIMESTAMP NULL,
  started_at     TIMESTAMP NULL,
  ready_at       TIMESTAMP NULL,
  delivered_at   TIMESTAMP NULL,
  completed_at   TIMESTAMP NULL,
  cancelled_at   TIMESTAMP NULL,
  cancel_reason  VARCHAR(300) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orders_public_id (public_id),
  KEY idx_orders_tenant_branch_status (tenant_id, branch_id, status),
  KEY idx_orders_session (session_id),
  KEY idx_orders_tenant_branch_ordered (tenant_id, branch_id, ordered_at),
  CONSTRAINT fk_orders_tenant      FOREIGN KEY (tenant_id)      REFERENCES tenants(id),
  CONSTRAINT fk_orders_branch      FOREIGN KEY (branch_id)      REFERENCES branches(id),
  CONSTRAINT fk_orders_session     FOREIGN KEY (session_id)     REFERENCES table_sessions(id),
  CONSTRAINT fk_orders_participant FOREIGN KEY (participant_id) REFERENCES session_participants(id),
  CONSTRAINT fk_orders_created_by  FOREIGN KEY (created_by)     REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ======================================================= order_items
CREATE TABLE order_items (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  order_id        BIGINT UNSIGNED NOT NULL,
  product_id      BIGINT UNSIGNED NOT NULL,
  variant_id      BIGINT UNSIGNED NULL,
  participant_id  BIGINT UNSIGNED NULL,
  name_snapshot   VARCHAR(200) NOT NULL,
  variant_snapshot VARCHAR(120) NULL,
  unit_price      DECIMAL(12,2) NOT NULL,          -- congelado
  qty             INT UNSIGNED NOT NULL DEFAULT 1,
  modifiers_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total      DECIMAL(12,2) NOT NULL,
  station_id      BIGINT UNSIGNED NULL,
  kitchen_status  VARCHAR(16) NOT NULL DEFAULT 'PENDING',  -- PENDING|QUEUED|PREPARING|READY|DELIVERED
  age_check       VARCHAR(12) NOT NULL DEFAULT 'NONE',     -- NONE|REQUIRED|VERIFIED|REJECTED
  note            VARCHAR(300) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order_items_order (order_id),
  KEY idx_order_items_station (station_id),
  CONSTRAINT fk_order_items_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_order_items_order   FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_order_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id),
  CONSTRAINT fk_order_items_participant FOREIGN KEY (participant_id) REFERENCES session_participants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================== order_item_modifiers
CREATE TABLE order_item_modifiers (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  modifier_id   BIGINT UNSIGNED NULL,             -- puede desaparecer del catálogo
  name_snapshot VARCHAR(120) NOT NULL,
  price_delta   DECIMAL(12,2) NOT NULL DEFAULT 0,
  KEY idx_order_item_modifiers_item (order_item_id),
  CONSTRAINT fk_oim_tenant FOREIGN KEY (tenant_id)     REFERENCES tenants(id),
  CONSTRAINT fk_oim_item   FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_oim_modifier FOREIGN KEY (modifier_id) REFERENCES modifiers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ======================================================= order_events
CREATE TABLE order_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  order_id   BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status  VARCHAR(24) NOT NULL,
  actor_kind VARCHAR(12) NOT NULL DEFAULT 'system',   -- guest|staff|system
  actor_id   BIGINT UNSIGNED NULL,
  reason     VARCHAR(300) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_order_events_order (order_id, created_at),
  CONSTRAINT fk_order_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_order_events_order  FOREIGN KEY (order_id)  REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ================================================== kitchen_stations
CREATE TABLE kitchen_stations (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  branch_id  BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(40) NOT NULL,
  name       VARCHAR(80) NOT NULL,
  type       VARCHAR(16) NOT NULL DEFAULT 'KITCHEN',   -- KITCHEN|BAR|COFFEE|COLD|DESSERT
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_kitchen_stations_branch_code (tenant_id, branch_id, code),
  CONSTRAINT fk_kitchen_stations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_kitchen_stations_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Reglas de ruteo a estación. Una regla es "de producto" (product_id),
-- "de categoría" (category_id) o "de sucursal" (ambos NULL = default).
-- La unicidad de la regla por alcance la garantiza el service (MySQL no
-- deja un ON DELETE CASCADE sobre una columna que alimente una columna
-- generada, así que no se usa scope_key generado).
CREATE TABLE product_station_routing (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  product_id  BIGINT UNSIGNED NULL,
  category_id BIGINT UNSIGNED NULL,
  station_id  BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_psr_product  (tenant_id, branch_id, product_id),
  UNIQUE KEY uq_psr_category (tenant_id, branch_id, category_id),
  CONSTRAINT fk_psr_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenants(id),
  CONSTRAINT fk_psr_branch   FOREIGN KEY (branch_id)   REFERENCES branches(id),
  CONSTRAINT fk_psr_product  FOREIGN KEY (product_id)  REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_psr_category FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_psr_station  FOREIGN KEY (station_id)  REFERENCES kitchen_stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ================================================== kitchen_tickets
CREATE TABLE kitchen_tickets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NOT NULL,
  station_id  BIGINT UNSIGNED NULL,               -- NULL = sucursal sin estaciones
  status      VARCHAR(12) NOT NULL DEFAULT 'QUEUED',  -- QUEUED|PREPARING|READY|DELIVERED
  sequence_no INT UNSIGNED NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at  TIMESTAMP NULL,
  ready_at    TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  KEY idx_kitchen_tickets_board (tenant_id, branch_id, station_id, status),
  KEY idx_kitchen_tickets_order (order_id),
  CONSTRAINT fk_kitchen_tickets_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_kitchen_tickets_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id),
  CONSTRAINT fk_kitchen_tickets_order   FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_kitchen_tickets_station FOREIGN KEY (station_id) REFERENCES kitchen_stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE kitchen_ticket_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id     BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  qty           INT UNSIGNED NOT NULL DEFAULT 1,
  status        VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  KEY idx_kti_ticket (ticket_id),
  CONSTRAINT fk_kti_ticket FOREIGN KEY (ticket_id)     REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_kti_item   FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Contador de secuencia de ticket por sucursal y día (número visible en el KDS).
CREATE TABLE kitchen_ticket_counters (
  tenant_id BIGINT UNSIGNED NOT NULL,
  branch_id BIGINT UNSIGNED NOT NULL,
  day       DATE NOT NULL,
  last_no   INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, branch_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
