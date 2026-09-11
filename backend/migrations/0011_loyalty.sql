-- Fase 10 — Fidelización (ARQUITECTURA_V1 §4.8). Cuenta de puntos por
-- cliente sobre `customers` (Fase 9). `loyalty:view`/`loyalty:adjust` ya
-- estaban sembrados en los roles de sistema desde 0002 — no hace falta un
-- permiso nuevo para ganar/canjear/ajustar puntos. Configurar niveles y la
-- regla de acumulación reusa `settings:manage` (mismo criterio que las
-- alícuotas de IVA en la Fase 8: es configuración del negocio, no una
-- operación diaria de caja).

SET NAMES utf8mb4;

-- ======================================================= loyalty_tiers
CREATE TABLE loyalty_tiers (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(40) NOT NULL,
  name       VARCHAR(80) NOT NULL,
  min_points INT UNSIGNED NOT NULL DEFAULT 0,
  multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  benefits   JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_tiers_tenant_code (tenant_id, code),
  CONSTRAINT fk_loyalty_tiers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ===================================================== loyalty_accounts
CREATE TABLE loyalty_accounts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  customer_id    BIGINT UNSIGNED NOT NULL,
  -- Caché mantenida transaccionalmente junto con cada fila del ledger
  -- (misma técnica que la reserva de stock: se lockea la cuenta con
  -- FOR UPDATE y se actualiza DENTRO de esa transacción) — nunca se
  -- confía en ella por fuera de este módulo; el ledger es la fuente de
  -- verdad y `points_balance` es sólo su acumulado.
  points_balance INT NOT NULL DEFAULT 0,
  tier_id        BIGINT UNSIGNED NULL,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_accounts_tenant_customer (tenant_id, customer_id),
  CONSTRAINT fk_loyalty_accounts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_loyalty_accounts_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_loyalty_accounts_tier FOREIGN KEY (tier_id) REFERENCES loyalty_tiers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ================================================= loyalty_transactions
-- Ledger; el balance se deriva de acá (nunca se pisa un total a mano).
CREATE TABLE loyalty_transactions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  type       VARCHAR(12) NOT NULL,   -- EARN|REDEEM|EXPIRE|ADJUST|REVERSAL
  points     INT NOT NULL,           -- con signo: EARN/REVERSAL(+) suman, REDEEM/EXPIRE/ADJUST(-) restan
  ref_type   VARCHAR(30) NULL,       -- p.ej. 'ORDER_PAYMENT'
  ref_id     BIGINT UNSIGNED NULL,
  reason     VARCHAR(300) NULL,
  actor_kind VARCHAR(12) NULL,       -- staff|system
  actor_id   BIGINT UNSIGNED NULL,
  expires_at TIMESTAMP NULL,         -- reservado: no hay todavía un worker que expire puntos (ver FASE10.md)
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Con esto, dos intentos de acreditar el mismo pago (p.ej. un reintento)
  -- son un no-op idempotente en vez de duplicar puntos. NULL no es
  -- duplicado en MySQL, así que un ADJUST/REDEEM manual sin ref_type/
  -- ref_id nunca choca contra otro.
  UNIQUE KEY uq_loyalty_txn_ref (tenant_id, ref_type, ref_id, type),
  KEY idx_loyalty_txn_account_created (account_id, created_at),
  CONSTRAINT fk_loyalty_txn_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_loyalty_txn_account FOREIGN KEY (account_id) REFERENCES loyalty_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ======================================================= loyalty_rules
CREATE TABLE loyalty_rules (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id            BIGINT UNSIGNED NOT NULL,
  scope                VARCHAR(20) NOT NULL DEFAULT 'GLOBAL',
  points_per_amount    DECIMAL(12,4) NOT NULL,   -- puntos ganados por cada $1 de total pagado
  multiplier_conditions JSON NULL,
  active               BOOLEAN NOT NULL DEFAULT 1,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_loyalty_rules_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
