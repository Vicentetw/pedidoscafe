# Fase 2 — Menú / catálogo · estado

Sigue `ARQUITECTURA_V1.md` §4.3 (ERD catálogo) y §20 (roadmap). Construida y
verificada contra la misma MySQL 8 de Docker + Firebase real que la Fase 1.

## Qué quedó hecho

### Base de datos — `migrations/0003_catalog.sql`
10 tablas nuevas, con las convenciones del §18 (InnoDB/utf8mb4, FKs reales,
`UNIQUE (tenant_id, …)` — nunca global):

- `menus` (`branch_id NULL` = menú global; `branch_scope` para el UNIQUE)
- `menu_categories` (con ventana horaria opcional `active_from`/`active_to` y
  `days_mask` — menú inteligente, `prompt.txt` §15)
- `products` (`base_price`, `currency`, `prep_minutes`, `requires_age_verification`)
- `product_branch_overrides` (precio / disponibilidad por sucursal, §3)
- `product_variants` (deltas de precio y de prep)
- `modifier_groups` / `modifiers` / `product_modifier_groups`
- `product_tags` / `product_tag_map`

### Backend — módulo `catalog`
- **`pricing.js`** — cálculo de precio en **centavos enteros** (sin error de
  flotante). `priceLine({ product, branchOverridePrice, variant, modifiers, qty })`
  toma SÓLO datos del catálogo; el precio nunca entra por parámetro del cliente.
- **`catalog.repository.js`** — todo el CRUD del catálogo + `buildPublicMenu(tenantId,
  branchId)` que arma el árbol menú→categoría→producto con override por sucursal
  aplicado. `tenantId` primero en toda función; todo `WHERE` lo lleva.
- **`catalog.schema.js`** — DTOs zod (código en kebab/snake, dinero con 2 decimales,
  horarios `HH:MM`, etc.).
- **`catalog.service.js`** — reglas: unicidad de código por alcance, FKs dentro del
  tenant, auditoría en cada mutación. **El cambio de precio va por su propio método**
  (`updateProductPrice`) y se audita como `update_price`. Menú público con filtrado
  por ventana horaria en la TZ de la sucursal y precio resuelto por producto/variante.
- **`catalog.routes.js`** — back-office bajo `/api/catalog`:
  `catalog:view` para GET · `catalog:manage` para mutaciones ·
  **`catalog:update_price`** para `PUT /products/:id/price` (el `PATCH` general
  ignora `basePrice`).
- **`menu.public.routes.js`** — superficie del comensal, **sin login**, bajo
  `/api/public/menu` (salta las 3 capas de identidad):
  - `GET /:tenantSlug/:branchCode` — el menú con precios ya calculados.
  - `POST /:tenantSlug/:branchCode/price` — total de una línea calculado por el
    backend a partir de `{ productCode, variantCode, modifierCodes, qty }`.
    **Si el body trae `price`/`unitPrice`, se ignora.**

### Frontend
- `admin/catalog-page.ts` — gestión menú → categorías → productos (lista + alta),
  ruta `/admin/menu` (`catalog:view`), en el nav del back-office.
- `client/menu-public-page.ts` — menú de vidriera, ruta `/m/:tenantSlug/:branchCode`,
  sin login. (La versión "desde la mesa" con sesión segura es la Fase 3.)

## Verificado

- `npm run migrate` — `0003_catalog.sql` aplica limpio (10 tablas).
- **`npm test` → 50 pass, 0 fail, 0 skip.** Nuevo en la Fase 2 (16 tests):
  - **`pricing.test.js`** (6) — base, override, variante + modificadores + cantidad,
    delta negativo, y que la función **no acepta un precio del cliente**.
  - **`catalog-public-menu.test.js`** (7) — el menú público devuelve el árbol con
    precio calculado por el backend; el override de sucursal cambia el precio; una
    categoría fuera de su ventana horaria **no aparece**; **`POST …/price` ignora un
    `price` inyectado en el body y devuelve el del catálogo** (mandatory case #4);
    local inexistente → 404.
  - **`catalog-isolation.test.js`** (7) — dos empresas con producto/categoría/menú de
    igual código: A nunca resuelve ni lista nada de B (repo + `buildPublicMenu` +
    `getPublicMenu` + `priceLinePreview`).
  - **`catalog-admin.test.js`** (4, HTTP con token real) — admin crea menú→categoría
    →producto→variante; un `mozo` no puede crear productos ni cambiar precios (403);
    el precio va por su endpoint y queda auditado como `update_price`; el `PATCH`
    general no toca el precio.
- `ng build` (dev y prod) OK con las dos pantallas nuevas.

## Cubierto de los 8 casos obligatorios

- **Caso 4** (el cliente intenta modificar el precio → el servidor lo rechaza):
  verificado en `pricing.test.js` (nivel función) y `catalog-public-menu.test.js`
  (nivel HTTP). Se reforzará en la Fase 4 cuando exista el carrito real.

## Próximo: Fase 3 — Mesas

`tables`, `qr_tokens` (token opaco + rotación), `table_sessions` + máquina de estados,
`session_participants` (guest mode), emisión/verificación del `table_session_token`
(el esqueleto ya está en `src/auth/sessionToken.js`), aviso "otra persona pidiendo"
por SSE, y `POST /table-sessions` con Turnstile. Cubre el **caso obligatorio 6**.
