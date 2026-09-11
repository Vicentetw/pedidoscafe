-- Fase 7 — POS / Caja (ARQUITECTURA_V1 §35, roadmap Fase 7).
--   cash_registers -> cash_sessions (apertura/cierre/arqueo) -> cash_movements
-- El vínculo con `payments` es OPCIONAL: cobrar en efectivo sin haber
-- abierto una caja sigue funcionando (Fase 6) — si se pasa una caja
-- abierta, además se deja el movimiento y la trazabilidad.

SET NAMES utf8mb4;

CREATE TABLE cash_registers (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  branch_id  BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(40) NOT NULL,
  name       VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_cash_registers_branch_code (tenant_id, branch_id, code),
  CONSTRAINT fk_cash_registers_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_cash_registers_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cash_sessions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  branch_id       BIGINT UNSIGNED NOT NULL,
  register_id     BIGINT UNSIGNED NOT NULL,
  status          VARCHAR(8) NOT NULL DEFAULT 'OPEN',  -- OPEN|CLOSED
  opened_by       BIGINT UNSIGNED NULL,
  opening_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  opened_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by       BIGINT UNSIGNED NULL,
  closing_amount  DECIMAL(12,2) NULL,
  expected_amount DECIMAL(12,2) NULL,
  difference      DECIMAL(12,2) NULL,
  closed_at       TIMESTAMP NULL,
  -- una sola sesión ABIERTA por caja (misma técnica que table_sessions:
  -- columna generada que sólo vale algo mientras status = OPEN). register_id
  -- NO lleva ON DELETE CASCADE/SET NULL a propósito -- MySQL no lo permite
  -- sobre una columna que alimenta una columna generada.
  active_register_id BIGINT UNSIGNED AS (CASE WHEN status = 'OPEN' THEN register_id ELSE NULL END) STORED,
  UNIQUE KEY uq_cash_sessions_one_open (active_register_id),
  KEY idx_cash_sessions_branch_status (tenant_id, branch_id, status),
  CONSTRAINT fk_cash_sessions_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenants(id),
  CONSTRAINT fk_cash_sessions_branch   FOREIGN KEY (branch_id)   REFERENCES branches(id),
  CONSTRAINT fk_cash_sessions_register FOREIGN KEY (register_id) REFERENCES cash_registers(id),
  CONSTRAINT fk_cash_sessions_opened_by FOREIGN KEY (opened_by)  REFERENCES app_users(id),
  CONSTRAINT fk_cash_sessions_closed_by FOREIGN KEY (closed_by)  REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cash_movements (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  branch_id       BIGINT UNSIGNED NOT NULL,
  cash_session_id BIGINT UNSIGNED NOT NULL,
  type            VARCHAR(12) NOT NULL,   -- SALE|REFUND|PAYOUT|DEPOSIT|ADJUST
  amount          DECIMAL(12,2) NOT NULL, -- con signo (PAYOUT negativo, etc.)
  payment_id      BIGINT UNSIGNED NULL,
  reason          VARCHAR(300) NULL,
  actor_user_id   BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cash_movements_session (cash_session_id),
  CONSTRAINT fk_cash_movements_tenant  FOREIGN KEY (tenant_id)       REFERENCES tenants(id),
  CONSTRAINT fk_cash_movements_branch  FOREIGN KEY (branch_id)       REFERENCES branches(id),
  CONSTRAINT fk_cash_movements_session FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id),
  CONSTRAINT fk_cash_movements_payment FOREIGN KEY (payment_id)      REFERENCES payments(id),
  CONSTRAINT fk_cash_movements_actor   FOREIGN KEY (actor_user_id)   REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- El pago en efectivo puede quedar vinculado a la caja que lo cobró (opcional).
ALTER TABLE payments
  ADD COLUMN cash_session_id BIGINT UNSIGNED NULL AFTER provider_ref,
  ADD CONSTRAINT fk_payments_cash_session FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id);

-- Permiso nuevo: cash:manage (alta de cajas físicas — configuración, no un
-- movimiento). Mismo criterio que tables:manage (Fase 3).
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'cash:manage'
FROM roles r
WHERE r.tenant_id IS NULL AND r.code IN ('owner','admin_general','admin_sucursal','encargado')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = 'cash:manage');
