-- Fase 13 — Hardware / Smart Waiting (ARQUITECTURA_V1 §4.9, prompt.txt §22-23).
-- Dos mecanismos de aviso, ninguno reemplaza al otro (prompt.txt: "no
-- eliminar el dispositivo físico"): buzzer físico asignado al pedido, y
-- aviso digital por SSE a una página de seguimiento pública (sin login,
-- token = orders.public_id, mismo criterio que el token de QR).
--
-- Permiso nuevo: `devices` no estaba en el catálogo de ninguna fase
-- anterior (a diferencia de crm/loyalty/promotions/reports, que ya venían
-- sembrados desde la Fase 1) — se agrega acá, igual que `tables:manage` en
-- la Fase 3 o `cash:manage` en la Fase 7.

SET NAMES utf8mb4;

CREATE TABLE devices (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  branch_id    BIGINT UNSIGNED NOT NULL,
  code         VARCHAR(40) NOT NULL,
  kind         VARCHAR(16) NOT NULL DEFAULT 'BUZZER',  -- BUZZER|PRINTER|KDS_SCREEN
  status       VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE|ASSIGNED|OFFLINE
  last_seen_at TIMESTAMP NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_devices_tenant_branch_code (tenant_id, branch_id, code),
  CONSTRAINT fk_devices_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_devices_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE device_assignments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  device_id   BIGINT UNSIGNED NOT NULL,
  order_id    BIGINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP NULL,
  KEY idx_device_assignments_order (order_id),
  KEY idx_device_assignments_device_active (device_id, released_at),
  CONSTRAINT fk_device_assignments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_device_assignments_device FOREIGN KEY (device_id) REFERENCES devices(id),
  CONSTRAINT fk_device_assignments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  branch_id   BIGINT UNSIGNED NULL,
  target_kind VARCHAR(12) NOT NULL,   -- GUEST|CUSTOMER|USER|DEVICE
  target_ref  VARCHAR(64) NOT NULL,   -- orders.public_id, customers.id, device code, etc.
  channel     VARCHAR(12) NOT NULL,   -- SSE|WEBPUSH|EMAIL|SMS|WHATSAPP|DEVICE
  template    VARCHAR(60) NOT NULL,
  payload     JSON NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'SENT', -- SENT|FAILED
  sent_at     TIMESTAMP NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_tenant_status (tenant_id, status),
  CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ================================================== permiso nuevo: devices
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'devices:view' AS permission UNION ALL SELECT 'devices:manage' UNION ALL SELECT 'devices:assign'
) p
WHERE r.tenant_id IS NULL AND r.code IN ('owner', 'admin_general', 'admin_sucursal')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
JOIN (
  SELECT 'devices:view' AS permission UNION ALL SELECT 'devices:assign'
) p
WHERE r.tenant_id IS NULL AND r.code IN ('encargado', 'cajero')
  AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = p.permission);
