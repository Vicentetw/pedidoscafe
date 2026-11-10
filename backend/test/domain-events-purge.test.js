// Falla 8 (base de 10 MB) — domain_events era la tabla que más crecía y
// nadie la lee después del despacho. La limpieza borra sólo lo despachado
// hace más de 7 días; nunca lo pendiente de despachar.
require('../src/config');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { resetTenant } = require('./helpers/db');
const { purgeDispatched } = require('../src/events/outbox');

const T = 998925;

before(async () => {
  await resetTenant(T);
  await db.query('INSERT INTO tenants (id, name, slug) VALUES (?, ?, ?)', [T, 'Purga eventos', 'purga-eventos-test']);
});

after(async () => {
  await resetTenant(T);
  await db.end().catch(() => {});
});

async function evt(type, dispatchedDaysAgo) {
  const [r] = await db.query(
    `INSERT INTO domain_events (tenant_id, type, payload, occurred_at, dispatched_at)
     VALUES (?, ?, JSON_OBJECT(), CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY,
             ${dispatchedDaysAgo == null ? 'NULL' : 'CURRENT_TIMESTAMP(3) - INTERVAL ? DAY'})`,
    dispatchedDaysAgo == null ? [T, type] : [T, type, dispatchedDaysAgo]
  );
  return r.insertId;
}
const exists = async (id) => (await db.query('SELECT COUNT(*) n FROM domain_events WHERE id = ?', [id]))[0][0].n === 1;

test('borra lo despachado hace más de 7 días; deja lo reciente y lo no despachado', async () => {
  const old = await evt('Viejo', 10);
  const recent = await evt('Reciente', 2);
  const pending = await evt('Pendiente', null);

  const deleted = await purgeDispatched({ olderThanDays: 7 });
  assert.ok(deleted >= 1);
  assert.equal(await exists(old), false, 'el viejo despachado se borra');
  assert.equal(await exists(recent), true, 'el reciente se conserva');
  assert.equal(await exists(pending), true, 'el no despachado nunca se borra');
});

test('borra de a lotes hasta terminar', async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await evt(`Lote${i}`, 9));
  await purgeDispatched({ olderThanDays: 7, batchSize: 2 });
  for (const id of ids) assert.equal(await exists(id), false);
});
