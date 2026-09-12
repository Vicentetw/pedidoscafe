-- Stock simple por producto (pedido en la aceptación): un contador
-- directo en el producto, sin recetas/ingredientes — pensado para el
-- caso común ("quedan 20 medialunas hoy"), no reemplaza el sistema de
-- ingredientes/recetas de la Fase 5 (ese sigue siendo lo correcto para
-- quien necesite trackear stock POR SUCURSAL o por insumo compartido).
--
-- track_stock = 0 (default): el producto no controla stock — "no
-- notificar stock" pedido en la aceptación (ej. café: no se agota).
-- stock_qty: cantidad actual disponible: baja con cada confirmación de
-- pedido, sube si se cancela el pedido entero. Al llegar a 0 el producto
-- deja de estar disponible (misma columna `is_active`/disponibilidad que
-- ya respeta todo el resto del sistema — no hace falta tocar nada más).
-- stock_min: aviso de "queda poco" (no oculta, sólo notifica).
--
-- Deliberadamente TENANT-WIDE, no por sucursal (a diferencia de
-- product_branch_overrides) — mantiene el modelo simple como se pidió;
-- un tenant multi-sucursal que necesite stock por sucursal debería usar
-- el sistema de ingredientes en su lugar.
ALTER TABLE products
  ADD COLUMN track_stock TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN stock_qty   INT NULL,
  ADD COLUMN stock_min   INT NULL;
