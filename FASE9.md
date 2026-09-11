# Fase 9 — CRM · estado

Sigue `ARQUITECTURA_V1.md` §4.8 (clientes, preferencias, segmentos — la parte de
segmentos queda para la Fase 11, ver nota abajo). Verificada contra la misma
MySQL 8 (Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0010_crm.sql`
- `customers` — nombre, teléfono, email (`UNIQUE(tenant_id, phone)` y
  `UNIQUE(tenant_id, email)` — NULL no cuenta como duplicado en MySQL, así que
  conviven bien varios clientes sin dato de contacto), fecha de nacimiento,
  sucursal habitual, `consent` (JSON), `first_seen_at`/`last_order_at`.
- `customer_preferences` — pares clave/valor por cliente (`PK(customer_id, key)`).
- **Vínculo con lo que ya existía**: `session_participants.customer_id` estaba
  reservado desde la Fase 3 (columna nullable sin FK); ahora tiene su FK real.
  Se agregó `orders.customer_id` (nuevo, nullable) para cubrir pedidos de
  **mostrador** (sin mesa/participante) — sin esta columna un cliente que compra
  siempre para llevar no tendría cómo aparecer en su propio historial.
- **Sin permiso nuevo**: `crm:view`/`crm:manage` ya estaban sembrados en los
  roles de sistema desde la Fase 1 (0002), pensados para esta fase. `view` lo
  tienen también mozo/cajero/encargado (buscar un cliente al tomar el pedido);
  `manage` (crear/editar/preferencias/linkear) queda sólo para dueño/admin —
  datos personales son más sensibles que ver el menú.

### Backend — módulo `crm`
- CRUD de clientes con detección de duplicado por teléfono/email (`409` con
  mensaje humano, no un error de MySQL crudo).
- Preferencias: `PUT` por clave es upsert (pisa el valor, no duplica filas).
- **Historial de compra** (`GET /customers/:id/orders`) combina dos caminos:
  pedidos con `customer_id` propio (mostrador) y pedidos de mesa donde el
  *participante* quedó linkeado al cliente — sin necesidad de reprocesar
  pedidos viejos.
- `POST /customers/:id/link-participant` — asocia un cliente a alguien sentado
  en una mesa (guest→registrado).
- **Integración con `orders`, hecha con el mismo patrón "aditivo" que
  `cash_session_id` en la Fase 7**: `orders.service.createOrder` acepta un
  `customerId` opcional (default `null`) que sólo agrega una columna al
  INSERT y, si viene, actualiza `customers.last_order_at` — los 14 call-sites
  existentes que no lo pasan (todos los tests de fases anteriores) siguen
  funcionando exactamente igual.

### Frontend
- `admin/crm-page.ts` (`/admin/clientes`, ítem "Clientes" en el menú) —
  buscar/crear/editar cliente, preferencias, historial de pedidos. Los campos
  de alta/edición sólo se muestran con `crm:manage`.

## Nota de alcance: "segmentos" queda para la Fase 11

`ARQUITECTURA_V1.md` menciona segmentos como parte de CRM. Se decidió no
construir acá un motor de segmentación genérico (reglas arbitrarias sobre el
historial) porque **todavía no hay nada que lo consuma**: el único lector real
de un "segmento" es el motor de promociones (`promotion_rules.condition_type
= CUSTOMER_TIER`, Fase 11) y fidelización (`loyalty_tiers`, Fase 10) — construir
la regla ahora, sin fidelización ni promociones todavía, sería adivinar la forma
que va a necesitar. Se prioriza lo que ya es útil solo (alta de clientes,
preferencias, historial) sobre una abstracción sin consumidor.

## Verificado

- `npm run migrate` — `0010_crm.sql` aplica limpio (2 tablas nuevas + FK sobre
  `session_participants` + columna nueva en `orders`).
- **`npm test` → 183 pass, 0 fail, 0 skip.** 14 tests nuevos en la Fase 9:
  - **`crm-flow.test.js`** (8) — alta y búsqueda; duplicado por teléfono/email
    rechazado; dos clientes sin contacto conviven; preferencias set/list/upsert;
    un pedido de mostrador con `customerId` entra al historial y actualiza
    `last_order_at`; linkear un participante de mesa lo suma al historial;
    linkear un participante inexistente y pedir un cliente inexistente dan 404.
  - **`crm-isolation.test.js`** (4) — el mismo teléfono en dos empresas no
    choca (el `UNIQUE` es por tenant); A nunca ve, obtiene ni edita nada de B.
  - **`crm-admin.test.js`** (2, HTTP con token real) — el dueño crea/edita un
    cliente; el mozo puede buscar (`crm:view`) pero no crear ni editar
    (`crm:manage`).
- Se re-corrieron además `orders-kitchen`, `orders-isolation`,
  `stock-reservation`, `stock-menu`, `stock-isolation` (20 tests) por tocar
  `orders.repository`/`orders.service` — sin regresiones.
- `ng build --configuration production` OK con `crm-page` nueva.

## Próximo: Fase 10 — Fidelización

`loyalty_tiers`/`loyalty_accounts`/`loyalty_transactions` (ledger de puntos,
el balance se deriva, nunca se pisa) sobre los `customers` de esta fase.
