# Fase 8 — Fiscal AFIP/ARCA · estado

Sigue `ARQUITECTURA_V1.md` (proveedor fiscal, análogo al de pagos) y el roadmap de
la Fase 8 (comprobantes, CAE, tipos A/B/C). Verificada contra la misma MySQL 8
(Docker) + Firebase real.

## Qué quedó hecho

### Base de datos — `migrations/0009_fiscal.sql`
- `fiscal_config` — CUIT, punto de venta, ambiente (`HOMOLOGACION`/`PRODUCCION`) y
  tipo de comprobante por defecto, por sucursal.
- `tax_rates` — alícuotas de IVA por tenant (código, nombre, %, una por defecto).
- `fiscal_documents` / `fiscal_document_items` — comprobantes emitidos, con
  `net_amount`/`tax_amount`/`total_amount` en centavos vía las mismas
  `toCents`/`fromCents` que catálogo/pagos/caja. `order_id` o `session_id`
  (nunca ambos), con `UNIQUE` sobre cada uno — **estructuralmente imposible**
  emitir dos comprobantes para el mismo pedido/mesa.
- `fiscal_document_counters` — numeración correlativa por sucursal + tipo.
- `afip_tokens` — preparada para el Login Ticket Request real (no usada aún).

### Backend — módulo `fiscal`
- **Patrón proveedor**, igual que pagos (`cash.provider.js`/`mercadopago.provider.js`
  en la Fase 6):
  - `ticketNoFiscal.provider.js` — **100% funcional**. Emite un ticket interno
    numerado, sin CAE. Es el comportamiento por defecto de todo el sistema.
  - `afip.provider.js` — **stub honesto**. `authenticate()`/`requestCAE()` lanzan
    `AFIP_NOT_CONFIGURED` (503) y el archivo documenta en detalle lo que hace
    falta para la integración real: certificado digital + CUIT dado de alta en
    AFIP, Login Ticket Request firmado en CMS, SOAP contra `wsaahomo.afip.gov.ar`
    (homologación) y después `wsaa.afip.gov.ar` (producción), `FECAESolicitar`
    de WSFEv1. No se escribió ese SOAP/firmado a ciegas — sin un CUIT y
    certificado reales no hay forma de verificar que funcione, y un adaptador
    fiscal que "aparenta" funcionar sin poder probarse es peor que uno que avisa
    claramente que falta configurar.
  - `issueDocument()` intenta AFIP sólo si hay un tipo real (`A`/`B`/`C`)
    configurado **con** CUIT; si no hay AFIP o falla con `AFIP_NOT_CONFIGURED`,
    **cae solo a ticket no fiscal** y lo marca (`fellBackToTicket: true`) — el
    sistema nunca se cae por falta de AFIP, sigue vendiendo y emitiendo.
- `issueForOrder`/`issueForSession` — **idempotentes** (buscan un comprobante
  existente antes de crear uno nuevo) y exigen que el pedido/mesa esté
  **totalmente pagado** antes de emitir.
- Reparto neto/IVA (`splitNetTax`) con la alícuota por defecto del tenant; sin
  alícuota configurada, neto = total e IVA = 0 (no se inventa una tasa).
- Permisos: **sin permiso nuevo** — configurar reusa `settings:view`/
  `settings:manage`, emitir reusa `payments:charge` (quien cobra puede darle el
  comprobante), listar reusa `payments:view`.

### Frontend
- `admin/fiscal-page.ts` (`/admin/fiscal`, nuevo ítem "Comprobantes" en el menú)
  — configuración de CUIT/punto de venta/ambiente/tipo por defecto, alta de
  alícuotas, emitir por Nº de pedido o de sesión de mesa, listado de emitidos.

## Verificado

- `npm run migrate` — `0009_fiscal.sql` aplica limpio (6 tablas nuevas).
- **`npm test` → 169 pass, 0 fail, 0 skip.** 9 tests nuevos en la Fase 8:
  - **`fiscal-flow.test.js`** (7) — ticket no fiscal sin AFIP configurado;
    emitir dos veces el mismo pedido devuelve el mismo comprobante; rechaza
    emitir sobre un pedido sin pagar; numeración correlativa por sucursal;
    con una alícuota del 21% el neto + IVA suman el total; emitir para una
    mesa saldada junta los ítems de todos sus pedidos; pedir un tipo real sin
    AFIP configurado cae a ticket, marcado.
  - **`fiscal-admin.test.js`** (2, HTTP con token real) — un `mozo` no puede
    ver ni configurar los datos fiscales; el `owner` sí, y por defecto ya emite
    ticket no fiscal.
- `ng build --configuration production` OK con `fiscal-page` nueva.
- **Bug real encontrado al correr la suite completa**: `catalog-public-menu.test.js`
  tenía una categoría con ventana horaria "imposible" (`00:00`–`00:01`) para
  probar que no aparece fuera de horario — pero esa ventana es real (un minuto
  por día) y la suite corrió justo a esa hora en Buenos Aires, así que falló
  por casualidad, no por nada de la Fase 8. Corregido para usar `days_mask = 0`
  (ningún día habilitado), que es determinístico y no depende del reloj.

## Próximo: Fase 9 — CRM

Clientes, historial de consumo por cliente/mesa, notas y preferencias — base
para la Fase 10 (fidelización) y la Fase 11 (promociones), que van a leer de acá.
