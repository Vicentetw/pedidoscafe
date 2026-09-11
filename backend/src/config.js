// Carga el .env de la RAÍZ del monorepo (un solo archivo para backend +
// migraciones), no uno propio de backend/. No tira si falta una variable:
// expone defaults y un assertDbConfig() que sí valida, para que los tests
// que no tocan la base puedan importar sin un .env completo.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

function csv(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3001),
  // URL pública de ESTE backend (ej. https://pedidoscofee-backend.onrender.com)
  // — sin esto, MercadoPago no tiene a dónde mandar el webhook de "se
  // aprobó el pago" (ver mercadopago.provider.js). Vacío en local a
  // propósito: localhost no es alcanzable desde MercadoPago, así que sin
  // deploy no tiene sentido mandar un notification_url igual.
  publicBackendUrl: process.env.PUBLIC_BACKEND_URL || null,

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  },

  // Filtro anti-bots. Si queda vacío, securityMiddlewares no lo exige
  // (mismo comportamiento que el sistema de asistencia en local).
  apiKey: process.env.API_KEY || null,
  corsOrigins: csv(process.env.CORS_ORIGINS).length
    ? csv(process.env.CORS_ORIGINS)
    : ['http://localhost:4200', 'http://127.0.0.1:4200'],

  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || null,
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT || null,
  },

  sessionToken: {
    secret: process.env.SESSION_TOKEN_SECRET || 'dev-insecure-session-secret',
    // Default subido de 2 a 6hs (una comida real puede durar más que 2) —
    // ahora que el frontend persiste el token en localStorage (no sólo
    // mientras la pestaña sigue abierta), un TTL corto era la otra mitad
    // del bug de "se duplican los participantes": aunque no cerrara la
    // app, a las 2hs el token vencía igual y forzaba un participante
    // nuevo. El scope del token sigue siendo sólo esa mesa/participante,
    // así que estirarlo no abre nada nuevo — sólo evita el vencimiento
    // prematuro de una comida larga.
    ttlHours: Number(process.env.SESSION_TOKEN_TTL_HOURS || 6),
  },

  publicSurface: {
    turnstileSecret: process.env.TURNSTILE_SECRET || null,
    countryAllowlist: csv(process.env.COUNTRY_ALLOWLIST),
  },

  mercadopago: {
    accessToken: process.env.MP_ACCESS_TOKEN || null,
    webhookSecret: process.env.MP_WEBHOOK_SECRET || null,
  },
};

// Llamado por server.js y por la migración: falla temprano y claro si la
// config de base está incompleta, en vez de un ECONNREFUSED críptico en
// el primer query.
function assertDbConfig() {
  const missing = ['user', 'database'].filter((k) => !config.db[k]);
  if (missing.length) {
    throw new Error(
      `Config de base incompleta: falta ${missing
        .map((k) => 'DB_' + k.toUpperCase())
        .join(', ')} en el .env de la raíz.`
    );
  }
}

module.exports = { config, assertDbConfig };
