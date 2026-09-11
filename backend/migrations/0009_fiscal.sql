-- Fase 8 — Fiscal (ARQUITECTURA_V1 §4.10, INSTRUCCIONES.md §3.2). Alcance
-- realista sin credenciales reales de AFIP en este entorno: el esquema
-- completo queda listo, y el sistema emite **ticket no fiscal** (interno,
-- numerado, sin CAE) hasta que haya un certificado y CUIT reales para
-- WSAA/WSFEv1 — ver FASE8.md.

SET NAMES utf8mb4;

CREATE TABLE fiscal_config (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  branch_id         BIGINT UNSIGNED NOT NULL,
  cuit              VARCHAR(13) NULL,             -- NULL = sin datos fiscales cargados (sólo ticket no fiscal)
  point_of_sale_no  SMALLINT UNSIGNED NULL,
  cert_ref          VARCHAR(200) NULL,            -- referencia al certificado (no el certificado en sí)
  environment       VARCHAR(16) NOT NULL DEFAULT 'HOMOLOGACION',  -- HOMOLOGACION|PRODUCCION
  default_doc_type  VARCHAR(8) NOT NULL DEFAULT 'TICKET',         -- TICKET|A|B|C
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fiscal_config_branch (tenant_id, branch_id),
  CONSTRAINT fk_fiscal_config_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_fiscal_config_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tax_rates (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT UNSIGNED NOT NULL,
  code      VARCHAR(40) NOT NULL,
  name      VARCHAR(80) NOT NULL,
  rate      DECIMAL(6,3) NOT NULL,   -- porcentaje, ej. 21.000
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_tax_rates_tenant_code (tenant_id, code),
  CONSTRAINT fk_tax_rates_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tokens de WSAA (Fase 8 real, todavía no ejercitada — ver FASE8.md).
CREATE TABLE afip_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NOT NULL,
  service      VARCHAR(20) NOT NULL,   -- 'wsfe'
  token        TEXT NOT NULL,
  sign_value   TEXT NOT NULL,
  generated_at TIMESTAMP NOT NULL,
  expires_at   TIMESTAMP NOT NULL,
  KEY idx_afip_tokens_lookup (tenant_id, branch_id, service, expires_at),
  CONSTRAINT fk_afip_tokens_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_afip_tokens_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fiscal_documents (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id        CHAR(26) NOT NULL,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  branch_id        BIGINT UNSIGNED NOT NULL,
  order_id         BIGINT UNSIGNED NULL,
  session_id       BIGINT UNSIGNED NULL,
  doc_type         VARCHAR(8) NOT NULL,     -- TICKET|A|B|C|NC_A|NC_B|NC_C
  point_of_sale_no SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  number           BIGINT UNSIGNED NULL,    -- número propio (TICKET) o el que devuelve AFIP
  cae              VARCHAR(20) NULL,
  cae_expires_at   DATE NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'ISSUED',  -- DRAFT|ISSUED|PENDING|AUTHORIZED|REJECTED|CONTINGENCY
  net_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  customer_doc_type VARCHAR(12) NULL,       -- CUIT|DNI|CF (consumidor final)
  customer_doc_no  VARCHAR(20) NULL,
  raw_request      JSON NULL,
  raw_response     JSON NULL,
  created_by       BIGINT UNSIGNED NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fiscal_documents_public_id (public_id),
  UNIQUE KEY uq_fiscal_documents_number (tenant_id, branch_id, point_of_sale_no, doc_type, number),
  KEY idx_fiscal_documents_order (order_id),
  KEY idx_fiscal_documents_session (session_id),
  CONSTRAINT fk_fiscal_documents_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_fiscal_documents_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id),
  CONSTRAINT fk_fiscal_documents_order   FOREIGN KEY (order_id)   REFERENCES orders(id),
  CONSTRAINT fk_fiscal_documents_session FOREIGN KEY (session_id) REFERENCES table_sessions(id),
  CONSTRAINT fk_fiscal_documents_created FOREIGN KEY (created_by) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE fiscal_document_items (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  document_id   BIGINT UNSIGNED NOT NULL,
  description   VARCHAR(200) NOT NULL,
  qty           DECIMAL(12,3) NOT NULL DEFAULT 1,
  unit_price    DECIMAL(12,2) NOT NULL,
  net_amount    DECIMAL(12,2) NOT NULL,
  tax_rate_id   BIGINT UNSIGNED NULL,
  tax_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount  DECIMAL(12,2) NOT NULL,
  KEY idx_fiscal_document_items_document (document_id),
  CONSTRAINT fk_fdi_document  FOREIGN KEY (document_id) REFERENCES fiscal_documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_fdi_tax_rate  FOREIGN KEY (tax_rate_id) REFERENCES tax_rates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Numeración correlativa por (sucursal, punto de venta, tipo de comprobante).
-- Para TICKET no fiscal la lleva el sistema; para comprobantes AFIP reales
-- el número lo devuelve WSFEv1 y esta tabla no se usa para esos.
CREATE TABLE fiscal_document_counters (
  tenant_id        BIGINT UNSIGNED NOT NULL,
  branch_id        BIGINT UNSIGNED NOT NULL,
  point_of_sale_no SMALLINT UNSIGNED NOT NULL,
  doc_type         VARCHAR(8) NOT NULL,
  last_number      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, branch_id, point_of_sale_no, doc_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
