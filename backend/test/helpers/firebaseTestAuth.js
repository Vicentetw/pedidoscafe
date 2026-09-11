// Portado de test-helpers/firebaseTestAuth.js del sistema de asistencia.
// Consigue un ID token real de Firebase para un usuario descartable y lo da
// de alta en app_users (sino appUserMiddleware lo rechaza con 403). Borra
// todo al terminar.
//
// Requiere en el .env de la raíz:
//   FIREBASE_SERVICE_ACCOUNT_PATH (o FIREBASE_SERVICE_ACCOUNT)
//   FIREBASE_WEB_API_KEY   -> API key web del proyecto (pública, no secreta)
//   API_KEY                -> el mismo x-api-key que exige el backend
const path = require('path');
const admin = require('firebase-admin');
const db = require('../../src/db');
const { config } = require('../../src/config');

const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';

function initAdmin() {
  if (admin.apps.length) return;
  const { serviceAccountPath, serviceAccountJson } = config.firebase;
  const serviceAccount = serviceAccountJson
    ? JSON.parse(serviceAccountJson)
    : require(path.resolve(__dirname, '..', '..', serviceAccountPath));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

/**
 * @param {string} uid
 * @param {{ isSuperadmin?:boolean, tenantId?:number|null, permissions?:string[]|null, roleCodes?:string[] }} opts
 *   - isSuperadmin true (default): ve todos los tenants.
 *   - isSuperadmin false + tenantId: usuario de esa empresa. Si no se pasan
 *     `permissions` ni `roleCodes`, se le dan TODOS los permisos vía
 *     user_permissions ALLOW (para aislar el efecto de TENANT del de permisos).
 */
async function getTestAuthHeaders(uid, { isSuperadmin = true, tenantId = null, permissions = null, roleCodes = null } = {}) {
  if (!WEB_API_KEY) throw new Error('Falta FIREBASE_WEB_API_KEY en el .env para los tests de integración.');
  initAdmin();

  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error('No se pudo obtener el ID token de prueba: ' + JSON.stringify(data));

  await db.query(
    `INSERT INTO app_users (firebase_uid, email, tenant_id, is_superadmin, status)
     VALUES (:uid, :email, :tenantId, :su, 'active')
     ON DUPLICATE KEY UPDATE tenant_id = VALUES(tenant_id), is_superadmin = VALUES(is_superadmin), status = 'active'`,
    { uid, email: `${uid}@test.local`, tenantId: isSuperadmin ? null : tenantId, su: isSuperadmin ? 1 : 0 }
  );
  const [[appUser]] = await db.query('SELECT id FROM app_users WHERE firebase_uid = :uid', { uid });

  if (!isSuperadmin) {
    await db.query('DELETE FROM user_permissions WHERE app_user_id = :id', { id: appUser.id });
    await db.query('DELETE FROM user_roles WHERE app_user_id = :id', { id: appUser.id });

    if (Array.isArray(roleCodes) && roleCodes.length) {
      const [roles] = await db.query(
        'SELECT id FROM roles WHERE code IN (?) AND (tenant_id IS NULL OR tenant_id = ?)',
        [roleCodes, tenantId]
      );
      if (roles.length) {
        await db.query('INSERT INTO user_roles (app_user_id, role_id, branch_id) VALUES ?', [
          roles.map((r) => [appUser.id, r.id, null]),
        ]);
      }
    } else {
      const { ALL_PERMISSIONS } = require('../../../shared/permissions');
      const granted = permissions !== null ? permissions : ALL_PERMISSIONS;
      if (granted.length) {
        await db.query('INSERT INTO user_permissions (app_user_id, permission, effect) VALUES ?', [
          granted.map((p) => [appUser.id, p, 'ALLOW']),
        ]);
      }
    }
  }

  return { 'x-api-key': config.apiKey || '', Authorization: `Bearer ${data.idToken}` };
}

async function deleteTestUser(uid) {
  initAdmin();
  await admin.auth().deleteUser(uid).catch(() => {});
  await db.query('DELETE FROM app_users WHERE firebase_uid = :uid', { uid }).catch(() => {});
}

// El pool nunca se cierra solo — sin esto `node --test` queda colgado.
async function closeDb() {
  await db.end().catch(() => {});
}

module.exports = { getTestAuthHeaders, deleteTestUser, closeDb };
