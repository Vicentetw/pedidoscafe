# Estrategia de pruebas

## Existente
- Backend: `node --test --test-concurrency=1`, 51 archivos, 283 tests contra MySQL real. Cubre aislamiento por empresa, RBAC, máquinas de estado, flujos de pedido/cocina/pago/webhook, stock, caja, promos, fidelización, fiscal, mesa cerrada.
- Frontend: **0 tests**. Sin e2e. Sin CI.

## Cómo correr sin riesgo (forma corta)
`bash backend/scripts/test-local.sh` (suite) o `bash backend/scripts/test-local.sh test/x.test.js`. Levanta el MySQL descartable, simula Firebase (`test/support/fake-firebase.js`), bloquea red externa, aborta si la base no es la descartable y borra el contenedor al final. Necesita Docker Desktop encendido.

## Cómo correr sin riesgo (a mano)
1. MySQL descartable: `docker run -d --name pc-test -p 127.0.0.1:33178:3306 -e MYSQL_ROOT_PASSWORD=x -e MYSQL_DATABASE=pc_test mysql:8.0`
2. Variables (dotenv no pisa las ya definidas):
   `DB_HOST=127.0.0.1 DB_PORT=33178 DB_USER=root DB_PASSWORD=x DB_NAME=pc_test`
   `FIREBASE_SERVICE_ACCOUNT_PATH= FIREBASE_SERVICE_ACCOUNT= FIREBASE_WEB_API_KEY= MP_ACCESS_TOKEN= API_KEY=`
3. `npm --prefix backend run migrate && npm --prefix backend test`
   - Sin Firebase: 236 pass, 46 skip, 1 fail ambiental (`health.test.js`).
   - Con un preload que simule `firebase-admin` y bloquee red externa: 283/283.
4. Borrar el contenedor al terminar.

**Nunca** con el `.env` real: 16 archivos crean usuarios en Firebase `restiapedidos` (producción).

## Faltantes prioritarios
- Un test por cada ítem abierto de `KNOWN_ISSUES.md` antes de corregirlo.
- Concurrencia webhook vs. "Verificar pago".
- Interceptor del frontend con sesión de staff + comensal en el mismo navegador.
- Reserva vencida de un pedido entregado tarde.
- CI que corra la suite antes de llegar a `main`.

## Detector de conexiones anidadas
Correr la suite con `DB_CONNECTION_LIMIT=1 node --test --test-concurrency=1 --test-timeout=20000`: un test colgado indica código que pide una 2ª conexión dentro de una transacción (en producción, con límite 3, cuelga el backend). Al 2026-11-10 el único caso era `adjustStock` (corregido).
