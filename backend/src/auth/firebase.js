const path = require('path');
const admin = require('firebase-admin');
const { config } = require('../config');
const { logger } = require('../logger');

// Portado de firebaseAuth.js del sistema de asistencia. Valida el ID token
// de Firebase (login email/password + Google del staff). Si Firebase Admin
// no está configurado (dev sin credenciales), deja pasar sin identidad —
// mismo fallback permisivo que asistencia, para no trabar el desarrollo
// local. En ese modo appUserMiddleware tampoco resuelve tenant y los
// tests que necesitan identidad real fallan explícitamente.
let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return;
  const { serviceAccountJson, serviceAccountPath } = config.firebase;
  if (!serviceAccountJson && !serviceAccountPath) return;
  try {
    const serviceAccount = serviceAccountJson
      ? JSON.parse(serviceAccountJson)
      : require(path.resolve(__dirname, '..', '..', serviceAccountPath));
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    initialized = true;
    logger.info('firebase_admin_ready', { projectId: serviceAccount.project_id });
  } catch (err) {
    logger.error('firebase_admin_init_failed', { message: err.message });
  }
}

async function firebaseAuthMiddleware(req, res, next) {
  initFirebaseAdmin();
  if (!initialized) return next(); // dev sin credenciales

  const header = req.headers.authorization || '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!idToken) {
    return res.status(401).json({ error: 'Falta el token de sesión.', code: 'UNAUTHORIZED' });
  }
  try {
    req.user = await admin.auth().verifyIdToken(idToken);
    return next();
  } catch (err) {
    req.log?.warn('firebase_verify_failed', { message: err.message });
    return res.status(401).json({ error: 'Tu sesión no es válida. Volvé a iniciar sesión.', code: 'UNAUTHORIZED' });
  }
}

module.exports = { firebaseAuthMiddleware, initFirebaseAdmin, isFirebaseReady: () => initialized };
