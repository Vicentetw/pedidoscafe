const { config } = require('../../src/config');

// Los tests de integración necesitan: MySQL con migraciones aplicadas +
// Firebase Admin + API key web + x-api-key. Si falta algo, se saltan (no
// fallan) — así `npm test` sirve en CI configurado y no molesta en una
// máquina sin base.
function integrationEnv() {
  const missing = [];
  if (!config.db.database || !config.db.user) missing.push('DB_*');
  if (!config.firebase.serviceAccountPath && !config.firebase.serviceAccountJson) missing.push('FIREBASE_SERVICE_ACCOUNT*');
  if (!process.env.FIREBASE_WEB_API_KEY) missing.push('FIREBASE_WEB_API_KEY');
  return { ok: missing.length === 0, skip: missing.length ? `sin entorno de integración (falta ${missing.join(', ')})` : false };
}

module.exports = { integrationEnv };
