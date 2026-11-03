# Esquema de base de datos

MySQL 8, utf8mb4, fechas en UTC como string. Toda tabla de negocio lleva `tenant_id`. ~66 tablas.

| Migración | Tablas |
|---|---|
| 0001 identidad | tenants, app_users, branches, roles, role_permissions, user_roles, user_permissions, audit_log, domain_events, settings |
| 0002 | Roles y permisos de sistema (seed) |
| 0003 catálogo | menus, menu_categories, products, product_branch_overrides, product_variants, modifier_groups, modifiers, product_modifier_groups, product_tags, product_tag_map |
| 0004 mesas | tables, qr_tokens, table_sessions, session_participants |
| 0005 pedidos | orders, order_items, order_item_modifiers, order_events, kitchen_stations, product_station_routing, kitchen_tickets, kitchen_ticket_items, kitchen_ticket_counters |
| 0006 stock | ingredients, recipes, recipe_items, stock, stock_movements, stock_reservations, suppliers, purchases, purchase_items |
| 0007 pagos | payments, payment_allocations, payment_transactions, mp_webhook_events, refunds |
| 0008 caja | cash_registers, cash_sessions, cash_movements |
| 0009 fiscal | fiscal_config, tax_rates, afip_tokens, fiscal_documents, fiscal_document_items, fiscal_document_counters |
| 0010 CRM | customers, customer_preferences |
| 0011 fidelización | loyalty_tiers, loyalty_accounts, loyalty_transactions, loyalty_rules |
| 0012 promos | promotions, promotion_rules, promotion_redemptions |
| 0013 analítica | daily_sales_rollup, product_sales_rollup |
| 0014 hardware | devices, device_assignments, notifications |
| 0015 | products.track_stock / stock_qty / stock_min (stock simple) |

## Relaciones clave
- `table_sessions` 1–N `session_participants`, 1–N `orders`; `tables.current_session_id` apunta a la sesión activa.
- `orders` 1–N `order_items` → `kitchen_ticket_items`; `orders.session_id` / `participant_id` / `customer_id` opcionales.
- `payments` → `session_id` u `order_id`; 1–N `payment_allocations`, `payment_transactions`, `refunds`; `cash_session_id` opcional.

## Crecimiento sin purga (límite 10 MB en Clever)
`domain_events` (sin consumidores), `audit_log`, `order_events`, `stock_movements`, `mp_webhook_events`.
