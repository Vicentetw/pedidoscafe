-- Fase 6 — Pagos (ARQUITECTURA_V1 §4.7, §6 máquina de estados de Payment,
-- §10-12 pago individual/conjunto/dividido, §29-34).
--   payments -> payment_allocations (qué cubre) / payment_transactions (historial c/ proveedor)
--   mp_webhook_events   (idempotencia de notificaciones de MercadoPago)
--   refunds
--
-- Eje de pago independiente del eje operativo del pedido (§5). El backend
-- SIEMPRE confirma un pago por su cuenta (webhook + re-consulta a MP, o
-- liquidación inmediata para efectivo) — nunca por lo que diga el navegador.

SET NAMES utf8mb4;

CREATE TABLE payments (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id          CHAR(26) NOT NULL,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  branch_id          BIGINT UNSIGNED NOT NULL,
  session_id         BIGINT UNSIGNED NULL,
  order_id           BIGINT UNSIGNED NULL,
  kind               VARCHAR(20) NOT NULL,   -- SESSION_GROUP|SESSION_INDIVIDUAL|SESSION_SPLIT|ORDER|COUNTER
  provider           VARCHAR(16) NOT NULL,   -- MERCADOPAGO|CASH
  method_detail      VARCHAR(60) NULL,
  amount             DECIMAL(12,2) NOT NULL,
  tip_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  currency           CHAR(3) NOT NULL DEFAULT 'ARS',
  status             VARCHAR(20) NOT NULL DEFAULT 'CREATED',
  status_detail      VARCHAR(160) NULL,
  external_reference VARCHAR(64) NOT NULL,
  provider_ref       VARCHAR(80) NULL,
  participant_id     BIGINT UNSIGNED NULL,   -- quién lo inició (pago individual) — informativo
  created_by         BIGINT UNSIGNED NULL,   -- staff que lo cargó (efectivo en mostrador)
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payments_public_id (public_id),
  UNIQUE KEY uq_payments_external_reference (external_reference),
  KEY idx_payments_tenant_branch_status (tenant_id, branch_id, status),
  KEY idx_payments_session (session_id),
  KEY idx_payments_order (order_id),
  CONSTRAINT fk_payments_tenant      FOREIGN KEY (tenant_id)      REFERENCES tenants(id),
  CONSTRAINT fk_payments_branch      FOREIGN KEY (branch_id)      REFERENCES branches(id),
  CONSTRAINT fk_payments_session     FOREIGN KEY (session_id)     REFERENCES table_sessions(id),
  CONSTRAINT fk_payments_order       FOREIGN KEY (order_id)       REFERENCES orders(id),
  CONSTRAINT fk_payments_participant FOREIGN KEY (participant_id) REFERENCES session_participants(id),
  CONSTRAINT fk_payments_created_by  FOREIGN KEY (created_by)     REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_allocations (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  payment_id     BIGINT UNSIGNED NOT NULL,
  order_id       BIGINT UNSIGNED NULL,
  order_item_id  BIGINT UNSIGNED NULL,
  participant_id BIGINT UNSIGNED NULL,   -- NULL = cubre "la mesa" en general (pago conjunto)
  amount         DECIMAL(12,2) NOT NULL,
  KEY idx_payment_allocations_payment (payment_id),
  CONSTRAINT fk_pa_tenant      FOREIGN KEY (tenant_id)      REFERENCES tenants(id),
  CONSTRAINT fk_pa_payment     FOREIGN KEY (payment_id)     REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_order       FOREIGN KEY (order_id)       REFERENCES orders(id),
  CONSTRAINT fk_pa_order_item  FOREIGN KEY (order_item_id)  REFERENCES order_items(id),
  CONSTRAINT fk_pa_participant FOREIGN KEY (participant_id) REFERENCES session_participants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_transactions (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  payment_id       BIGINT UNSIGNED NOT NULL,
  type             VARCHAR(16) NOT NULL,   -- AUTHORIZE|CAPTURE|REFUND|CHARGEBACK
  provider_txn_id  VARCHAR(80) NULL,
  amount           DECIMAL(12,2) NOT NULL, -- con signo
  status            VARCHAR(20) NULL,
  raw_json         JSON NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_payment_transactions_payment (payment_id),
  CONSTRAINT fk_pt_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_pt_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Idempotencia de webhooks: una notificación con el mismo mp_notification_id
-- se descarta si ya se procesó (caso obligatorio 3).
CREATE TABLE mp_webhook_events (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mp_notification_id VARCHAR(80) NOT NULL,
  topic              VARCHAR(40) NULL,
  resource_id        VARCHAR(80) NULL,
  signature_ok       TINYINT(1) NOT NULL DEFAULT 0,
  processed_at       TIMESTAMP(3) NULL,
  payload_json       JSON NULL,
  received_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mp_webhook_events_notification (mp_notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE refunds (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  payment_id   BIGINT UNSIGNED NOT NULL,
  amount       DECIMAL(12,2) NOT NULL,
  reason       VARCHAR(300) NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'APPROVED',  -- APPROVED|PENDING|REJECTED
  provider_ref VARCHAR(80) NULL,
  created_by   BIGINT UNSIGNED NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_refunds_payment (payment_id),
  CONSTRAINT fk_refunds_tenant     FOREIGN KEY (tenant_id)   REFERENCES tenants(id),
  CONSTRAINT fk_refunds_payment    FOREIGN KEY (payment_id)  REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_refunds_created_by FOREIGN KEY (created_by)  REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Permiso ya existía en el catálogo (payments:view/charge/refund/manage_mp_credentials)
-- y ya está sembrado en los roles desde la Fase 1 (0002_seed_system_roles.sql).
