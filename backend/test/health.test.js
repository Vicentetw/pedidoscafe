require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers/server');

// Este archivo NO toca la base — sólo /health y respuestas de auth previas
// al pool. No cierra el pool (nunca abrió conexiones); --test-force-exit
// se encarga del teardown del proceso.
let srv;
before(async () => {
  srv = await startTestServer();
});
after(async () => {
  await srv.close();
});

test('GET /health responde ok sin autenticación', async () => {
  const res = await fetch(`${srv.baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('rutas de /api sin credenciales -> 401', async () => {
  const res = await fetch(`${srv.baseUrl}/api/platform/users/me`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, 'UNAUTHORIZED');
});

test('cualquier ruta protegida sin credenciales -> 401 (aunque no exista)', async () => {
  // Con Firebase Admin configurado, el gate de auth corre ANTES del router:
  // un /api/* sin token es 401, exista o no la ruta. Es lo correcto —
  // no se filtra qué rutas hay.
  const res = await fetch(`${srv.baseUrl}/api/no-existe`);
  assert.equal(res.status, 401);
});

test('ruta inexistente bajo un path público -> 404 con forma estable', async () => {
  const res = await fetch(`${srv.baseUrl}/health/no-existe`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(typeof body.error === 'string' && body.code);
});
