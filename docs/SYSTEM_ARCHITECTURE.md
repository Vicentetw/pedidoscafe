# Arquitectura

Monolito modular Express 5 + mysql2 sin ORM ("Camino C"). Un solo pool (`db.js`), una sola forma de abrir transacciones (`withTransaction.js`); los repos aceptan `conn` opcional.

## Cuatro identidades
| Superficie | Prefijo | Cómo se identifica |
|---|---|---|
| Staff / admin | `/api/*` | `x-api-key` (opcional, hoy vacío) → Firebase ID token → fila `app_users` → `requireTenantId` + `requirePermission` |
| Comensal | `/api/session/*` | JWT `table_session_token` (tenant, branch, mesa, participante); revalidado contra la DB en cada request |
| Público | `/api/public/*` | QR opaco, slug del local, o `public_id` del pedido. Firewall por país + Turnstile al crear sesión |
| Webhook MP | `/webhooks/mercadopago` | Firma opcional + re-consulta a la API de MP |

Superadmin: sin tenant propio; opera con `?tenantId=`.
Sin Firebase configurado el backend deja pasar sin identidad y corta en `requirePermission` (401).

## Tiempo real y eventos
- SSE en memoria (`http/sse.js`): filtra por tenant, branch, topic; comensal sólo su sesión; seguimiento sólo su pedido. No escala a más de una instancia.
- Outbox (`domain_events`): se escribe en la transacción y un worker lo despacha al bus. **El bus no tiene suscriptores.**
- Jobs: liberar reservas de stock vencidas (60 s).

## Errores
Los servicios tiran `DomainError` y sus subclases; `errorHandler` responde `{error, code, details}`. Hay casos con `status: 200` y error (ver KNOWN_ISSUES).

## Frontend
Angular standalone. `authInterceptor` agrega el Bearer de Firebase y `?tenantId` del superadmin a todo request al backend. `TableSessionService` guarda el JWT del comensal en localStorage por mesa.
