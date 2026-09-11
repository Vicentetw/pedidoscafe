# App nativa Android (Capacitor) — para mozos, empleados y dueños

No es una fase del roadmap original (eso ya cerró en la Fase 13) — es la app
nativa que pediste después, envolviendo la misma web de staff/admin que ya
existía. El comensal sigue entrando por QR en el navegador, sin instalar
nada — eso fue una decisión de diseño explícita del propio `prompt.txt`
(§23: "no requiere app" es una ventaja del modo QR), no un olvido acá.

## Qué se armó

- **Capacitor** (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`)
  envuelve el build de Angular en un proyecto Android nativo (carpeta
  `frontend/android/`, un proyecto de Gradle/Android Studio normal). **No
  toca nada de la web existente**: `ng serve`/`ng build` siguen funcionando
  exactamente igual; Capacitor sólo agrega archivos nuevos.
- **`environment.mobile.ts`** (nuevo) — el APK lleva los archivos de Angular
  empaquetados adentro, pero igual necesita hablar por red con el backend.
  Por eso tiene una URL de backend **absoluta** (la IP de esta PC en su red
  local), a diferencia de `environment.ts` (web de producción) que usa `''`
  (relativo, pensado para cuando el backend se sirva desde el mismo dominio
  que el frontend).
- **`ng build --configuration mobile`** (script `npm run build:mobile`) —
  usa ese environment. `npm run android` = build mobile + `cap sync`
  (copia los archivos nuevos adentro del proyecto Android).
- Ya generé un **APK de debug** y te lo mandé aparte (`app-debug.apk`,
  ~4.3 MB). Se instala directo en cualquier Android, **sin pasar por Google
  Play** — es justo lo que pediste: generarlo sin publicarlo.

## Cómo instalarlo en un celular

1. Pasale el archivo `app-debug.apk` al celular (WhatsApp a vos mismo, un
   cable USB, Google Drive, lo que te resulte más cómodo).
2. Abrilo desde el celular. Android va a pedir permiso para "instalar apps
   de origen desconocido" — es normal para un APK que no viene de la Play
   Store, aceptalo sólo para este archivo.
3. Se instala como cualquier app, con su ícono (por ahora el genérico de
   Capacitor — ver "Pendiente" más abajo).

## Importante: por ahora sólo funciona en la MISMA red que esta PC

El APK de debug apunta a `http://172.155.0.252:3001` — la IP de esta PC en
su red. Para que el celular pueda cobrar/tomar pedidos de verdad:

1. El celular tiene que estar en el **mismo Wi-Fi** que esta PC.
2. El backend tiene que estar corriendo acá (`node server.js`, puerto
   3001) — igual que para probar la web.
3. **El Firewall de Windows puede estar bloqueando la conexión entrante.**
   No pude crear la regla yo (necesita permisos de administrador que no
   tengo desde acá). Si el celular no logra cargar nada:
   - Fijate si Windows te mostró un cartel tipo "¿Permitir que Node.js se
     comunique en redes privadas?" en algún momento — si le diste
     "Cancelar" sin querer, hay que revertirlo.
   - O agregá la regla vos mismo: Panel de control → Firewall de Windows
     Defender → Configuración avanzada → Reglas de entrada → Nueva regla →
     Puerto → TCP → 3001 → Permitir la conexión.

Si la IP de esta PC cambia (reiniciás el router, cambiás de red, etc.):

1. Corré `ipconfig` acá, buscá la IPv4 del adaptador real (el de "Ethernet"
   o "Wi-Fi" — no los que dicen "vEthernet", esos son de Docker/WSL/
   VirtualBox).
2. Editá `frontend/src/environments/environment.mobile.ts`, cambiá
   `backendUrl`.
3. Volvé a generar el APK (paso a paso abajo).

**Para que la app funcione sin depender de esta PC prendida** (la usen
mozos desde cualquier lado, no sólo en el local con tu PC encendida) hace
falta desplegar el backend en un servidor con URL pública — eso ya es un
tema de hosting/deploy, no de la app en sí. Si querés, lo vemos aparte.

## Cómo generar el APK vos mismo (para la próxima vez)

Necesitás, en esta misma PC (ya están instalados, los encontré al armar
esto):

- **JDK 21** — está en `C:\Program Files\Android\openjdk\jdk-21.0.8` (el
  de Android Studio). El JDK 11 que también tiene la PC NO alcanza: el
  plugin de Gradle de Android pide Java 17 o más nuevo.
- **Android SDK** — está en `%LOCALAPPDATA%\Android\Sdk`.

Pasos, desde `frontend/`:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\openjdk\jdk-21.0.8"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npm run android          # build de Angular (config "mobile") + copia a Android
cd android
.\gradlew.bat assembleDebug
```

El APK queda en `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

Si en cambio tenés **Android Studio** instalado con interfaz gráfica: abrís
la carpeta `frontend/android/` como proyecto, y "Build → Build APK(s)" hace
lo mismo con clics en vez de terminal — probablemente más cómodo para
iterar si vas a tocar esto seguido.

## Pendiente (no lo hice porque no lo pediste todavía)

- **Ícono y splash screen propios** — hoy usa el genérico de Capacitor. Para
  ponerle uno de pedidoscofee hace falta un archivo de imagen (logo) que no
  tengo; con eso, `@capacitor/assets` lo genera en todos los tamaños solo.
- **Publicar en Google Play** — necesita una cuenta de Google Play Console
  (USD 25 pago único), firmar la app con una keystore de verdad (no el debug
  actual), y pasar la revisión de Google. Nada de esto es técnico complejo,
  pero necesita que abras esas cuentas vos.
- **App para iPhone** — Capacitor también soporta iOS, pero compilarla
  requiere Xcode, que sólo corre en Mac. No hay Mac en este entorno.
- **Redirección automática por rol** (un mozo abre la app y cae directo en
  `/staff`, un dueño en `/admin`) — hoy la app abre en el mismo lugar que la
  web (`/admin`, con el mismo menú lateral). Es una decisión de UX chica que
  se puede sumar fácil si la querés.
