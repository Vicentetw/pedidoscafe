const db = require('../../src/db');

// Borra TODO lo de un tenant descartable, en orden hoja→raíz para no chocar
// con las FK. Cubre todas las fases; si una tabla todavía no existe, el
// DELETE falla en silencio. Uso: `await resetTenant(999900)`.
//
// IDs de tenant de test: un id repetido entre dos archivos rompe el
// `before()` del que corre después ("Duplicate entry ... for key
// 'tenants.PRIMARY'"), incluso si cada archivo limpia bien el suyo — node
// --test corre los archivos en el mismo proceso de MySQL, uno tras otro.
// Antes de sumar un archivo nuevo con un tenant descartable:
//   grep -rnE "^const T[A-Z]? = [0-9]+" test/*.test.js | sort -t= -k2 -n
// y elegir un número que no aparezca. 998xxx quedó para pagos/caja
// (Fases 6-7); 999xxx es todo lo anterior.
async function resetTenant(tenantId) {
  const j = async (sql, params) => { try { await db.query(sql, params); } catch { /* tabla ausente / vacía */ } };

  // kitchen_ticket_items no tiene tenant_id: se borra vía join.
  await j(
    `DELETE kti FROM kitchen_ticket_items kti
       JOIN kitchen_tickets kt ON kt.id = kti.ticket_id
      WHERE kt.tenant_id = ?`,
    [tenantId]
  );
  for (const t of [
    'notifications',
    'device_assignments',
    'devices',
    'product_sales_rollup',
    'daily_sales_rollup',
    'promotion_redemptions',
    'promotion_rules',
    'promotions',
    'loyalty_transactions',
    'loyalty_accounts',
    'loyalty_rules',
    'loyalty_tiers',
    'fiscal_document_items',
    'fiscal_documents',
    'refunds',
    'payment_transactions',
    'payment_allocations',
    'payments',
    'cash_movements',
    'cash_sessions',
    'cash_registers',
    'fiscal_document_counters',
    'afip_tokens',
    'tax_rates',
    'fiscal_config',
    'stock_reservations',
    'stock_movements',
    'purchase_items',
    'purchases',
    'stock',
    'recipe_items',
    'recipes',
    'kitchen_tickets',
    'kitchen_ticket_counters',
    'product_station_routing',
    'order_events',
    'order_item_modifiers',
    'order_items',
    'orders',
    'session_participants',
  ]) {
    await j(`DELETE FROM ${t} WHERE tenant_id = ?`, [tenantId]);
  }
  await j(`UPDATE tables SET current_session_id = NULL WHERE tenant_id = ?`, [tenantId]);
  for (const t of [
    'customer_preferences',
    'customers',
    'table_sessions',
    'qr_tokens',
    'kitchen_stations',
    'tables',
    'product_tag_map',
    'product_tags',
    'product_modifier_groups',
    'modifiers',
    'modifier_groups',
    'product_branch_overrides',
    'product_variants',
    'products',
    'menu_categories',
    'menus',
    'ingredients',
    'suppliers',
    'settings',
    'audit_log',
    'domain_events',
    'user_permissions',
    'user_roles',
    'roles',
    'app_users',
    'branches',
  ]) {
    await j(`DELETE FROM ${t} WHERE tenant_id = ?`, [tenantId]);
  }
  await j(`DELETE FROM tenants WHERE id = ?`, [tenantId]);
}

module.exports = { resetTenant };
