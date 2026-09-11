-- Fase 3 — Mesas, QR y sesiones de mesa (ARQUITECTURA_V1 §4.5, §7, §15).
--   tables          -> mesa física de una sucursal
--   qr_tokens       -> token OPACO impreso en la mesa (rotable, revocable)
--   table_sessions  -> sesión abierta en una mesa (máquina de estados §7)
--   session_participants -> quiénes están en la sesión (guest mode, §8)
--
-- Seguridad del QR (§26): el token no lleva NADA de negocio; el backend
-- resuelve tenant/branch/table server-side. El scope del comensal sale del
-- table_session_token (JWT) que emite el backend, nunca del body.

SET NAMES utf8mb4;

-- ============================================================ tables
CREATE TABLE tables (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  branch_id          BIGINT UNSIGNED NOT NULL,
  code               VARCHAR(24)  NOT NULL,
  name               VARCHAR(80)  NULL,
  seats              TINYINT UNSIGNED NOT NULL DEFAULT 2,
  zone               VARCHAR(40)  NULL,
  status             VARCHAR(24)  NOT NULL DEFAULT 'FREE',  -- FREE|RESERVED|OCCUPIED|BILL_REQUESTED|CLOSING
  current_session_id BIGINT UNSIGNED NULL,
  created_by          BIGINT UNSIGNED NULL,
  updated_by          BIGINT UNSIGNED NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         TIMESTAMP NULL,
  UNIQUE KEY uq_tables_tenant_branch_code (tenant_id, branch_id, code),
  KEY idx_tables_tenant_branch_status (tenant_id, branch_id, status),
  CONSTRAINT fk_tables_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_tables_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id),
  CONSTRAINT fk_tables_created FOREIGN KEY (created_by) REFERENCES app_users(id),
  CONSTRAINT fk_tables_updated FOREIGN KEY (updated_by) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================ qr_tokens
CREATE TABLE qr_tokens (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  BIGINT UNSIGNED NOT NULL,
  branch_id  BIGINT UNSIGNED NOT NULL,
  table_id   BIGINT UNSIGNED NOT NULL,
  token      VARCHAR(64) NOT NULL,               -- opaco: base64url de 32 bytes aleatorios
  status     VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE|ROTATED|REVOKED
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at TIMESTAMP NULL,
  UNIQUE KEY uq_qr_tokens_token (token),
  KEY idx_qr_tokens_table_status (tenant_id, table_id, status),
  CONSTRAINT fk_qr_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_qr_tokens_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_qr_tokens_table  FOREIGN KEY (table_id)  REFERENCES tables(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ======================================================= table_sessions
CREATE TABLE table_sessions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id     CHAR(26) NOT NULL,                 -- ULID, se usa hacia afuera
  tenant_id     BIGINT UNSIGNED NOT NULL,
  branch_id     BIGINT UNSIGNED NOT NULL,
  table_id      BIGINT UNSIGNED NOT NULL,
  status        VARCHAR(24) NOT NULL DEFAULT 'OPEN',
                -- OPEN|ORDERING|SERVING|BILL_REQUESTED|PARTIALLY_PAID|PAID|CLOSED|ABANDONED|FORCE_CLOSED
  order_mode    VARCHAR(12) NOT NULL DEFAULT 'INDIVIDUAL',  -- INDIVIDUAL|GROUP
  total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency      CHAR(3) NOT NULL DEFAULT 'ARS',
  waiter_user_id BIGINT UNSIGNED NULL,
  opened_by_kind VARCHAR(12) NOT NULL DEFAULT 'guest',   -- guest|staff
  close_reason   VARCHAR(300) NULL,
  opened_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at     TIMESTAMP NULL,
  UNIQUE KEY uq_table_sessions_public_id (public_id),
  KEY idx_table_sessions_tenant_branch_status (tenant_id, branch_id, status),
  KEY idx_table_sessions_table (table_id, status),
  CONSTRAINT fk_table_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_table_sessions_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_table_sessions_table  FOREIGN KEY (table_id)  REFERENCES tables(id),
  CONSTRAINT fk_table_sessions_waiter FOREIGN KEY (waiter_user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Una mesa tiene a lo sumo UNA sesión no terminal. Índice único parcial no
-- existe en MySQL; se usa una columna generada que vale table_id sólo
-- mientras la sesión está viva, y NULL cuando terminó.
ALTER TABLE table_sessions
  ADD COLUMN active_table_id BIGINT UNSIGNED
    AS (CASE WHEN status IN ('OPEN','ORDERING','SERVING','BILL_REQUESTED','PARTIALLY_PAID','PAID')
             THEN table_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uq_table_sessions_one_active (active_table_id);

ALTER TABLE tables
  ADD CONSTRAINT fk_tables_current_session FOREIGN KEY (current_session_id) REFERENCES table_sessions(id);

-- ================================================= session_participants
CREATE TABLE session_participants (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id    CHAR(26) NOT NULL,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  session_id   BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(60) NOT NULL,
  nickname     VARCHAR(60) NULL,
  seat_no      TINYINT UNSIGNED NULL,
  customer_id  BIGINT UNSIGNED NULL,               -- CRM (Fase 9); NULL = anónimo
  kind         VARCHAR(12) NOT NULL DEFAULT 'GUEST',  -- GUEST|REGISTERED
  joined_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at      TIMESTAMP NULL,
  UNIQUE KEY uq_session_participants_public_id (public_id),
  KEY idx_session_participants_session (session_id),
  CONSTRAINT fk_session_participants_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_session_participants_session FOREIGN KEY (session_id) REFERENCES table_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ================================ permiso nuevo: tables:manage (mesas + QR)
-- Se agrega a los roles que ya administran la operación.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'tables:manage'
FROM roles r
WHERE r.tenant_id IS NULL AND r.code IN ('owner','admin_general','admin_sucursal','encargado')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = 'tables:manage');
