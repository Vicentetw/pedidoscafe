#!/usr/bin/env node
// Runner de migraciones. Patrón del sistema de asistencia, endurecido:
//   - cada archivo .sql de esta carpeta corre UNA sola vez, en orden por
//     nombre (prefijo numérico 0001_, 0002_, ...);
//   - lo aplicado se registra en `schema_migrations` (nombre + checksum +
//     fecha); si el contenido de un archivo ya aplicado cambió, aborta y
//     avisa (una migración no se edita después de correr — se hace una nueva);
//   - conecta por las variables del .env de la raíz (config.js), nunca
//     credenciales en el código.
//
//   node migrations/run-sql.js            aplica lo pendiente
//   node migrations/run-sql.js --status   lista qué falta / qué se aplicó

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { config, assertDbConfig } = require('../src/config');

const DIR = __dirname;
const STATUS_ONLY = process.argv.includes('--status');

function sqlFiles() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d+.*\.sql$/i.test(f))
    .sort();
}

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function main() {
  assertDbConfig();
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
    dateStrings: true,
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) NOT NULL PRIMARY KEY,
        checksum   CHAR(16)     NOT NULL,
        applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const [appliedRows] = await conn.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(appliedRows.map((r) => [r.filename, r.checksum]));

    const files = sqlFiles();
    if (!files.length) {
      console.log('No hay archivos de migración en', DIR);
      return;
    }

    let pending = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(DIR, file), 'utf8');
      const sum = checksum(content);
      const prevSum = applied.get(file);

      if (prevSum) {
        if (prevSum !== sum) {
          throw new Error(
            `La migración ya aplicada "${file}" cambió de contenido (checksum ${prevSum} → ${sum}). ` +
              `Una migración no se edita después de correr: creá una nueva.`
          );
        }
        if (STATUS_ONLY) console.log(`  [ok]      ${file}`);
        continue;
      }

      pending++;
      if (STATUS_ONLY) {
        console.log(`  [PENDING] ${file}`);
        continue;
      }

      process.stdout.write(`Aplicando ${file} ... `);
      try {
        await conn.query(content);
        await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [file, sum]);
        console.log('ok');
      } catch (err) {
        console.log('FALLÓ');
        console.error(`\nError en ${file}:\n${err.message}\n`);
        process.exitCode = 1;
        return;
      }
    }

    if (STATUS_ONLY) {
      console.log(`\n${pending} pendiente(s), ${applied.size} aplicada(s).`);
    } else if (pending === 0) {
      console.log('Base al día — nada que aplicar.');
    } else {
      console.log(`\n${pending} migración(es) aplicada(s).`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
