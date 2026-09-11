# Deploy a producción — paso a paso

Tres piezas, cada una en un proveedor distinto:

| Pieza | Proveedor | Qué es |
|---|---|---|
| Base de datos MySQL | **Clever Cloud** | tus datos reales |
| Backend (API Express) | **Render** | el `backend/` de este repo |
| Frontend (Angular) | **Firebase Hosting** | el `frontend/` de este repo |

Se hace en ESE orden (cada paso necesita datos del anterior): primero la
base, después el backend (que necesita la base), después el frontend
(que necesita la URL del backend).

Antes de empezar: **el código ya está commiteado localmente** (rama
`main`, commit inicial). Falta subirlo a GitHub — Render se conecta a un
repo de GitHub, no a tu disco.

---

## 0. Subir el código a GitHub

1. Entrá a [github.com/new](https://github.com/new), creá un repo vacío
   (privado si querés), por ejemplo `pedidoscofee`. **No** marques
   "Add a README" ni ".gitignore" (ya los tenemos).
2. En tu terminal, en `C:\angular\pedidoscofee`:

```bash
git remote add origin https://github.com/TU-USUARIO/pedidoscofee.git
git branch -M main
git push -u origin main
```

Con eso Render y (más adelante) Firebase ya pueden apuntar a este repo.

---

## 1. Base de datos — Clever Cloud (MySQL)

1. Creá una cuenta en [clever-cloud.com](https://www.clever-cloud.com/) y
   logueate.
2. **Create** → **Add an application** → elegí **"An add-on"** (o desde
   el dashboard: **Create an add-on**) → **MySQL**.
3. Plan: el gratuito ("DEV", ~10 MB) alcanza para arrancar; si tu volumen
   de datos crece vas a tener que subir de plan más adelante — eso es
   normal, no bloquea el arranque.
4. Elegí una región (cualquiera de Europa/US sirve; no hay región en
   Argentina, la latencia extra es aceptable para este tipo de app).
5. Una vez creado, andá a la pestaña **"Information"** del addon. Vas a
   ver algo como:

```
Host: bxxxxxxxxxxxx-mysql.services.clever-cloud.com
Port: 3306
Database: bxxxxxxxxxxxx
User: uxxxxxxxxxxxx
Password: (botón "reveal")
```

   Guardá esos 5 valores — son tus `DB_HOST` / `DB_PORT` / `DB_NAME` /
   `DB_USER` / `DB_PASSWORD` para los próximos pasos.

### Correr las migraciones contra Clever Cloud

Las migraciones se corren **una sola vez**, desde tu máquina, apuntando
temporalmente a la base remota (no hace falta redeploy del backend para
esto — es un paso manual, aparte).

1. En `C:\angular\pedidoscofee\.env` (tu archivo local, el que NO se
   commitea), cambiá momentáneamente `DB_HOST`/`DB_PORT`/`DB_USER`/
   `DB_PASSWORD`/`DB_NAME` por los valores de Clever Cloud. **Guardá
   aparte una copia de tus valores locales** (Docker) para volver a
   pegarlos después — los vas a necesitar para seguir desarrollando en
   local.
2. Corré las migraciones:

```bash
cd backend
npm run migrate
```

   (si el script se llama distinto, revisá `backend/package.json` →
   sección `scripts`; el comando exacto que usa este proyecto está ahí).
3. Verificá que las tablas se crearon — desde el dashboard de Clever
   Cloud hay un botón para abrir una consola / o podés usar cualquier
   cliente MySQL (TablePlus, DBeaver, MySQL Workbench) con esos mismos 5
   datos.
4. **Restaurá tu `.env` local a los valores de Docker** para seguir
   desarrollando en tu máquina sin tocar la base de producción por
   accidente.

> ⚠️ A partir de acá, cada vez que agregues una migración nueva vas a
> tener que repetir el paso 2 apuntando a Clever Cloud (o armar un script
> de deploy que lo automatice — por ahora, manual).

---

## 2. Backend — Render

1. Entrá a [render.com](https://render.com/), creá cuenta, conectá tu
   cuenta de GitHub (te va a pedir autorizar acceso al repo que creaste
   en el paso 0).
2. **New** → **Blueprint**. Elegí el repo `pedidoscofee`. Render va a
   leer el `render.yaml` que ya está en la raíz del repo y proponerte un
   servicio llamado `pedidoscofee-backend` con:
   - Root directory: `backend`
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check: `/health`

   Si preferís hacerlo a mano en vez de por Blueprint (**New** → **Web
   Service**), configurá esos mismos 4 valores manualmente y elegí el
   plan **Free**.

3. Antes de confirmar el deploy, completá las variables de entorno que
   el `render.yaml` deja en blanco (`sync: false`) — pestaña
   **Environment**:

   | Variable | Valor |
   |---|---|
   | `DB_HOST` | el host de Clever Cloud |
   | `DB_PORT` | `3306` |
   | `DB_USER` | el user de Clever Cloud |
   | `DB_PASSWORD` | el password de Clever Cloud |
   | `DB_NAME` | el database de Clever Cloud |
   | `PUBLIC_BACKEND_URL` | dejalo vacío por ahora — lo completás en el paso 2.5, una vez que Render te dé la URL |
   | `API_KEY` | opcional; dejalo vacío si no lo vas a usar |
   | `CORS_ORIGINS` | dejalo vacío por ahora — lo completás en el paso 4, con la URL final de Firebase |
   | `FIREBASE_SERVICE_ACCOUNT` | ver abajo |
   | `SESSION_TOKEN_SECRET` | Render puede generarlo solo (`generateValue: true` en el blueprint) |
   | `SESSION_TOKEN_TTL_HOURS` | `2` |
   | `TURNSTILE_SECRET` | dejalo vacío si no usás Turnstile todavía |
   | `COUNTRY_ALLOWLIST` | `AR` |
   | `MP_ACCESS_TOKEN` | tu access token de MercadoPago (test o real) |
   | `MP_WEBHOOK_SECRET` | tu webhook secret de MercadoPago |

   **`FIREBASE_SERVICE_ACCOUNT`** — en local usás un archivo
   (`serviceAccountKey.json`, vía `FIREBASE_SERVICE_ACCOUNT_PATH`), pero
   ese archivo NO está en git (por seguridad) así que en Render no existe.
   La alternativa que el backend ya soporta es pegar el JSON completo
   como texto:
   1. Abrí tu `backend/serviceAccountKey.json` local.
   2. Copiá **todo** el contenido tal cual (es un JSON de una sola pieza).
   3. Pegalo como valor de la variable `FIREBASE_SERVICE_ACCOUNT` en
      Render (no hace falta escapar nada, Render acepta multilínea).
   4. **No** pongas `FIREBASE_SERVICE_ACCOUNT_PATH` en Render — dejala
      sin definir, así el backend usa la variable JSON en su lugar.

4. Confirmá el deploy. Render va a instalar dependencias, arrancar
   `npm start` y pegarle a `/health` para confirmar que levantó. Vas a
   terminar con una URL del estilo:

   ```
   https://pedidoscofee-backend.onrender.com
   ```

### 2.5 Cerrar el círculo: `PUBLIC_BACKEND_URL`

Con la URL de Render ya conocida, volvé a **Environment** en Render y
completá:

```
PUBLIC_BACKEND_URL=https://pedidoscofee-backend.onrender.com
```

Esto es lo que hace que MercadoPago sepa a dónde mandar el aviso de
"se aprobó el pago" (`notification_url` del checkout) — sin esto, los
pagos con MercadoPago sólo se actualizan si alguien aprieta "Verificar
pago" a mano en el panel. Guardar la variable dispara un redeploy
automático.

> Nota: el plan Free de Render "duerme" el servicio tras ~15 min sin
> tráfico y tarda unos segundos en despertar en el próximo pedido — es
> normal, no es un error. Si esto molesta para el uso real, el paso
> siguiente es pasar a un plan pago.

---

## 3. Frontend — Firebase Hosting

### 3.1 Iniciar sesión con la cuenta correcta

Este proyecto de Firebase (`restiapedidos`) es tuyo
(`perrottavicente@gmail.com`). Si en tu máquina el CLI de Firebase quedó
logueado con otra cuenta, cambiala:

```bash
cd C:\angular\pedidoscofee
firebase login
```

Esto abre el navegador — iniciá sesión con **la cuenta que tiene acceso
al proyecto `restiapedidos`**. Confirmá que lo ve:

```bash
firebase projects:list
```

Tiene que aparecer `restiapedidos` en la lista (ya está configurado como
proyecto default en `.firebaserc`, en la raíz del repo).

### 3.2 Apuntar el frontend al backend real

Antes de compilar para producción, editá
[frontend/src/environments/environment.ts](frontend/src/environments/environment.ts)
y completá la URL de Render del paso 2:

```ts
export const environment = {
  production: true,
  backendUrl: 'https://pedidoscofee-backend.onrender.com', // ← acá
  apiKey: '',
  firebaseConfig: { /* no tocar, ya está bien */ },
};
```

(Si en el futuro vas a tener staging y producción con distintos
backends, se puede armar una configuración `staging` en `angular.json`
igual que existe `mobile` — por ahora, un solo ambiente de producción
alcanza.)

### 3.3 Compilar y desplegar

```bash
cd frontend
npm run build          # usa la config "production" por defecto
cd ..
firebase deploy --only hosting
```

`firebase.json` (en la raíz del repo) ya apunta a
`frontend/dist/pedidoscofee/browser` — la carpeta real que genera el
build (confirmado en este mismo build de prueba) — y ya tiene el
rewrite de SPA (`**` → `/index.html`) para que las rutas de Angular
funcionen al refrescar la página.

Al terminar, la terminal te va a mostrar la URL pública, algo como:

```
https://restiapedidos.web.app
```

(o `https://restiapedidos.firebaseapp.com` — ambas apuntan a lo mismo).

---

## 4. Cerrar el círculo: CORS

Con la URL final de Firebase ya conocida, volvé a Render →
**Environment** → completá:

```
CORS_ORIGINS=https://restiapedidos.web.app,https://restiapedidos.firebaseapp.com
```

(separadas por coma, sin espacios extra). Guardar dispara otro redeploy
automático del backend. Sin este paso, el navegador va a bloquear los
pedidos del frontend al backend con un error de CORS en la consola.

---

## 5. Probar de punta a punta

1. Abrí la URL de Firebase en el celular y en la compu.
2. Iniciá sesión como superadmin/dueño, elegí la empresa (`?tenantId=`
   ya no hace falta escribirlo a mano — el selector de empresa del panel
   lo maneja solo).
3. Generá un QR de una mesa real (`Mesas` → `Ver QR`), escaneálo con el
   celular apuntando a la URL de Firebase.
4. Hacé un pedido y probá cobrar — si usás MercadoPago, con
   `PUBLIC_BACKEND_URL` ya configurado el pago se va a confirmar solo
   (webhook); si no, usá el botón "Verificar pago" como respaldo.

---

## Resumen de variables por lugar

**Render** (backend) — completar en el dashboard, nunca en el repo:
`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
`PUBLIC_BACKEND_URL`, `CORS_ORIGINS`, `FIREBASE_SERVICE_ACCOUNT`,
`SESSION_TOKEN_SECRET`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, etc.
(lista completa y comentada en [render.yaml](render.yaml)).

**Frontend** (Firebase) — no usa variables de entorno de verdad (es
estático); en su lugar, `backendUrl` se fija a mano en
[environment.ts](frontend/src/environments/environment.ts) antes de cada
build de producción (paso 3.2).

**Local** (tu máquina) — sigue usando `.env` en la raíz del repo (nunca
se commitea) contra el MySQL de Docker, tal como hasta ahora. No cambia
nada de tu flujo de desarrollo día a día.

---

## Archivos nuevos que arma este setup

- [firebase.json](firebase.json) — config de Firebase Hosting.
- [.firebaserc](.firebaserc) — proyecto default (`restiapedidos`).
- [render.yaml](render.yaml) — blueprint de Render (backend), con la
  lista completa de variables de entorno necesarias documentada.
- `PUBLIC_BACKEND_URL` — variable nueva (ver
  [backend/src/config.js](backend/src/config.js) y
  [.env.example](.env.example)), usada para que MercadoPago sepa a dónde
  mandar el webhook de pago aprobado una vez que hay un backend público
  de verdad.
