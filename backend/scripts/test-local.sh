#!/usr/bin/env bash
# Corre la suite del backend contra un MySQL DESCARTABLE en Docker, con
# Firebase simulado y sin red externa. Nunca usa el .env real (que apunta a
# la base local de otro proyecto y crea usuarios en Firebase de producción).
#
#   bash backend/scripts/test-local.sh                 # suite completa
#   bash backend/scripts/test-local.sh test/x.test.js  # uno o varios archivos
#   KEEP_DB=1 bash backend/scripts/test-local.sh ...   # no borra el contenedor
#
# Requiere Docker Desktop encendido.
set -euo pipefail

NAME=pc-test-local
PORT=33179
HERE="$(cd "$(dirname "$0")/.." && pwd)"

if ! docker info >/dev/null 2>&1; then
  echo "Docker no está corriendo. Abrí Docker Desktop y probá de nuevo." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p 127.0.0.1:$PORT:3306 \
    -e MYSQL_ROOT_PASSWORD=fix_tmp -e MYSQL_DATABASE=pc_fix mysql:8.0 >/dev/null
  echo "Esperando a MySQL..."
  for _ in $(seq 1 90); do
    docker logs "$NAME" 2>&1 | grep -q "ready for connections.*port: 3306" && break
    sleep 2
  done
fi

export DB_HOST=127.0.0.1 DB_PORT=$PORT DB_USER=root DB_PASSWORD=fix_tmp DB_NAME=pc_fix DB_CONNECTION_LIMIT=${DB_CONNECTION_LIMIT:-10}
export FIREBASE_SERVICE_ACCOUNT_PATH= MP_ACCESS_TOKEN= API_KEY= FIREBASE_WEB_API_KEY=fake
export FIREBASE_SERVICE_ACCOUNT='{"project_id":"fake","client_email":"f@f.invalid","private_key":"x"}'
PRELOAD="$HERE/test/support/fake-firebase.js"
command -v cygpath >/dev/null && PRELOAD="$(cygpath -m "$PRELOAD")"
export NODE_OPTIONS="--require $PRELOAD"

# Cinturón y tiradores: si algo de arriba no quedó, no se corre nada.
if [ "$DB_PORT" != "$PORT" ] || [ "$DB_NAME" != "pc_fix" ]; then
  echo "ABORTADO: la base no es la descartable ($DB_HOST:$DB_PORT/$DB_NAME)." >&2
  exit 1
fi

cd "$HERE"
npm run -s migrate
status=0
if [ $# -gt 0 ]; then
  node --test --test-concurrency=1 "$@" || status=$?
else
  node --test --test-concurrency=1 || status=$?
fi

if [ "${KEEP_DB:-0}" != "1" ]; then docker rm -f "$NAME" >/dev/null; fi
exit $status
