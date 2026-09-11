# Sistema de café/restaurante SaaS — Instrucciones de arranque

Este documento es el puente entre el **sistema de asistencia** ya existente
(`C:\angular\horasDedicacionOnline` + `C:\angular\horasDedicacionOnlineAngular`)
y este proyecto nuevo. Lo escribió Claude tras trabajar a fondo en el de
asistencia; resume qué código conviene reutilizar, qué decisión hay que
tomar antes de escribir una línea, y cómo seguir.

El pedido de producto completo está en `prompt.txt` (en este mismo
directorio). Este archivo NO lo reemplaza — lo complementa con la parte de
reutilización y la revisión del prompt.

---

## 1. Decisión que hay que tomar ANTES de empezar: stack

El `prompt.txt` recomienda **NestJS + TypeScript + TypeORM/Prisma + monorepo**.
El sistema de asistencia (de donde sale el código reutilizable) es
**Express + JavaScript (sin TS) + `mysql2` a pelo (sin ORM) + 2 repos separados**.

**No se mezclan sin costo.** Hay tres caminos:

| Camino | Qué implica | Reúso real del código de asistencia |
|---|---|---|
| **A. NestJS + TS + ORM (seguir el prompt tal cual)** | Estructura de framework, DI, decorators, migraciones del ORM. Rehacés auth/permisos/billing/tenant en estilo NestJS. | El código de asistencia queda como **plano/referencia** (reglas de negocio y casos borde ya resueltos), no como copiar-pegar. El frontend Angular sí se reusa más directo. |
| **B. Express + JS + `mysql2` (igual que asistencia)** | Copiás los módulos de infra casi verbatim. Sin framework: la estructura la ponés vos a mano. | **Máximo** — auth, permisos, tenant, security, billing casi tal cual. |
| **C. Express + JS + `mysql2`, pero con estructura estricta por dominio** (recomendado) | Carpeta por dominio, capas route/service/repository, validación de DTO con `zod` o similar. 80% del orden de NestJS sin el rewrite. TypeScript se puede sumar de a poco. | **Máximo**, igual que B, pero el proyecto no se vuelve un plato de fideos al crecer. |

**Recomendación de Claude: camino C.** Motivo: sos un solo dev, y rehacer
auth + permisos + billing + multi-tenant **bien** en NestJS es exactamente
lo que llevó varias sesiones lograr la primera vez (esta última sesión fue
casi toda arreglar bugs de aislamiento entre empresas). El prompt tiene
razón en que la complejidad de este dominio pide estructura — pero esa
estructura se puede imponer con disciplina de carpetas + capas, sin pagar
el costo de reimplementar la infra en otro framework.

Si igual elegís NestJS: que sea una decisión consciente, sabiendo que la
infra se reescribe.

---

## 2. Qué reutilizar del sistema de asistencia (y de qué archivo sale)

Rutas relativas a `C:\angular\horasDedicacionOnline\backendonline2\` (backend)
y `C:\angular\horasDedicacionOnlineAngular\horas-dedica-angular\` (frontend).

### Infraestructura backend — reúso directo (camino B/C) o de referencia (camino A)

| Necesidad del prompt | De dónde sacarlo | Notas |
|---|---|---|
| Login (email + Google, Firebase) | frontend `src/app/core/auth.ts`, interceptor, componente login; test helper `test-helpers/firebaseTestAuth.js` | Tiene fixes ganados a los golpes: `authStateReady()` (evita 401 en la carga inicial), recarga completa en login/logout (evita datos de otra sesión en pantalla). NO los pierdas. |
| Multi-tenant + permisos (RBAC) | `appUserMiddleware.js` (`resolveTenantId`, `requirePermission`, `requireSuperadmin`), tablas `app_users` / `roles` / `role_permissions` / `user_permissions` | El modelo `permiso = "modulo:accion"` string, roles como presets + overrides individuales. Ya probado con tests de aislamiento. |
| Aislamiento entre empresas — **cómo hacerlo bien** | `test/full-tenant-isolation.test.js` | **Copiá el enfoque de este test tal cual.** Dos empresas con TODO igual (mismo legajo/ID/badge/fechas), y verifica que A nunca ve nada de B en cada pantalla. En el café: dos empresas con el mismo nombre de producto, misma mesa Nº, mismo QR, etc. |
| Claves únicas: SIEMPRE `(tenant_id, X)`, nunca `X` global | migraciones `20260909_*` y `20260910_*` | Lección cara de esta sesión: `USERID`, `legajo`, `badge` estaban con UNIQUE global → una 2da empresa no podía usar los mismos números. En el café aplicá esto desde el día 1: `(tenant_id, branch_id, code)` en productos, mesas, etc. Y FK reales a `tenants(id)`. |
| Un solo pool de conexiones por proceso | `db.js` | Otra lección cara: había 2 pools descoordinados y Clever Cloud bloqueaba por límite de conexiones. Un `createPool` único, `connectionLimit` por debajo del límite del hosting, todo el código usa ESE. |
| Seguridad HTTP | `security.js` (helmet, rate-limit, CORS, API key, `publicPaths`), `motor-laboral/middleware/countryFirewallMiddleware.js`, `motor-laboral/services/turnstileService.js` | Firewall por país (geoip-lite local) + captcha Turnstile para la superficie sin login. |
| Cobrar la **suscripción** a la cafetería (el dueño paga el software) | `routes/billing.js`, `motor-laboral/services/billingCalculations.js`, `motor-laboral/services/mercadopagoService.js`, tablas `tenant_subscriptions` / `plans` / `payment_records` / `plan_requests` | Esto es MercadoPago **preapproval/suscripciones**. Distinto de cobrar al comensal (eso es Orders/Point/QR — ver punto 3). |
| Validación de firma del webhook de MercadoPago | `motor-laboral/services/mercadopagoService.js` (`verifyWebhookSignature`) + `routes/mercadopagoWebhook.js` | **Reusable tal cual.** Es lo que impide que alguien falsifique un "pago confirmado". El webhook se monta ANTES de `express.json()` y de `securityMiddlewares()` (necesita el body crudo para la firma). |
| Landing pública + alta autoservicio de una empresa nueva | `routes/public.js` + `horas-dedica-angular/public/landing.html` | Alta de tenant + usuario admin + suscripción trial, todo de una. Reusable con cambios de copy. |
| Idempotencia / migraciones / `run-sql.js` | carpeta `migrations/` + `run-sql.js` en la raíz del repo de deploy | Patrón: cada `.sql` corre una vez, `information_schema` para chequeos condicionales, `run-sql.js` conecta por env vars nunca commiteadas. |
| Config del suite de tests | `package.json` → `"test": "node --test --test-force-exit --test-concurrency=1"` | `--test-force-exit`: el pool de mysql2 mantenía vivo el proceso y colgaba el suite. `--test-concurrency=1`: los tests de integración contra la base real se pisan si corren en paralelo. |

### Frontend Angular — reúso directo (Angular es Angular en cualquier camino)

| Necesidad | De dónde |
|---|---|
| Shell / layout (sidebar oscuro colapsable, responsive, menú de usuario) | `src/app/core/shell/` (`.ts/.html/.css`) |
| Tema claro/oscuro + Material 3 | `src/app/core/theme.ts`, `src/material-theme.scss` |
| Estilos compartidos (tarjetas resumen, chips de estado, tablas, campos) | `src/styles.css` — está unificado a propósito, una sola definición de cada clase |
| Componentes chicos reutilizables | `src/app/shared/` — `info-hint`, `sync-status-banner`, `export.ts` (CSV con BOM para Excel, PDF) |
| Guards de permisos + ruteo con `{ superadminOnly }` / `{ permission }` | `src/app/app.routes.ts`, `src/app/core/permission-guard.ts` |
| Pantallas de plataforma casi tal cual | `tenants/` (Empresas), `billing/` (Facturación, Planes, Pagos), `users/` (Usuarios y Roles), `security/` (firewall + monitor de pool) |

### Qué NO sirve (es puro asistencia/RRHH)

Todo `motor-laboral/` (cálculo de asistencia), fichajes, `Checkins`, el agente
Python del reloj (`descarga-fichaje-py/`), horarios/plantillas de turno, horas
extra, licencias, matching usuario-reloj, presentismo, feriados, salidas/movimientos.

---

## 3. Revisión del `prompt.txt` — ajustes sugeridos

El prompt está muy completo. Cambios/agregados:

1. **Stack (crítico)** — ver punto 1 de este documento. El prompt asume NestJS+TS+ORM;
   si vas a reutilizar la infra de asistencia conviene Express+JS+`mysql2` con
   estructura estricta. Decidilo antes de pedirle a la IA que arranque, y
   editá el prompt (secciones 43, 44, 61) según lo que elijas.

2. **Facturación electrónica AFIP/ARCA — está subvalorada.** El prompt solo la
   menciona al pasar ("facturación electrónica posteriormente", sección 64).
   Vos dijiste que la querés. Es un **módulo grande y 100% nuevo**: certificado
   digital, autenticación WSAA (token/sign), WSFEv1, ambiente de homologación
   primero, obtención de CAE, manejo de contingencia, tipos de comprobante
   A/B/C, alícuotas de IVA. Agregá una **Fase dedicada** (después de POS/Pagos)
   y arrancá el resto con **ticket no fiscal** para no bloquear el desarrollo.

3. **Concurrencia de stock — definir el mecanismo temprano.** El prompt dice
   "Redis cuando sea necesario". Para un monolito modular arrancando, alcanza
   con **locking pesimista a nivel base** (`SELECT ... FOR UPDATE` sobre la
   fila de stock dentro de una transacción). MySQL/`mysql2` lo soportan bien.
   Redis recién si el volumen lo pide. Decidilo en la fase de arquitectura,
   no sobre la marcha.

4. **MercadoPago — dos integraciones distintas, no una.**
   - Cobrar la **suscripción** a la cafetería → preapproval/suscripciones
     (reusás `mercadopagoService.js` de asistencia casi tal cual).
   - Cobrar al **comensal** en el mostrador/mesa → Orders API + Point + QR
     (es nuevo). La firma del webhook y la idempotencia sí se comparten.
   El prompt ya pide bien "PaymentProvider con adaptadores" — mantené eso, y
   que haya **dos adaptadores de MercadoPago** o uno con dos modos.

5. **Monorepo — sí, hacelo.** El sistema de asistencia quedó partido en 2
   repos (dev + deploy) por un accidente histórico y fue una molestia toda la
   sesión. Empezá con **un solo repo** (frontend + backend + tipos compartidos),
   un solo deploy.

6. **El resto del prompt está bien.** Las secciones de concurrencia (6, 12, 59),
   máquinas de estado (10, 31), seguridad de QR (25, 26), anti-fraude (47),
   testing obligatorio (58) y el orden de implementación por fases (73) son
   sólidas. No les toques nada.

---

## 4. Qué se hizo hasta ahora

**En este proyecto: nada todavía.** Es greenfield. Este archivo + `prompt.txt`
son todo el contenido del directorio.

**En el sistema de asistencia (referencia):** ver
`C:\angular\horasDedicacionOnline\AUDITORIA_Y_ROADMAP_VENTA.md` — el registro
de sesiones tiene el detalle de todo lo de multi-tenant/aislamiento que se
arregló y que acá conviene hacer bien desde el arranque.

---

## 5. Qué hacer ahora (primer objetivo)

Seguí el **punto 76 del `prompt.txt`** al pie de la letra: la primera tarea
NO es escribir el sistema, es producir el **documento de arquitectura v1**:

- Arquitectura general + de módulos (bounded contexts).
- Modelo de dominio + ERD MySQL inicial (tablas, campos, relaciones, índices,
  constraints — con `(tenant_id, branch_id, ...)` en toda clave única).
- Máquinas de estado: `Order`, `Payment`, `TableSession`.
- Flujos (diagramas Mermaid) de los casos difíciles: **dos personas pidiendo
  a la vez desde la misma mesa + stock 1 + pago individual/conjunto + MercadoPago**.
- Modelo multi-tenant + RBAC (partiendo del de asistencia).
- Seguridad del QR (token firmado, validación server-side, nada de precio/stock
  desde el front).
- Plan de testing (los 8 casos obligatorios de la sección 58).
- Roadmap por fases (sección 73) + dónde entra AFIP.

Recién con eso validado, empezar a programar.
