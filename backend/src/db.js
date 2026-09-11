const mysql = require('mysql2/promise');
const { config } = require('./config');

// El ÚNICO pool de todo el proceso (lección cara del sistema de asistencia:
// dos pools descoordinados hacían que el hosting bloqueara por límite de
// conexiones). Todo el código — repositories, migraciones vía import,
// jobs — usa ESTE módulo. connectionLimit sale del .env para poder
// dejarlo por debajo del tope real del hosting.
//
// namedPlaceholders: los repos pueden usar `WHERE tenant_id = :tenantId`
// además del `?` posicional — más legible en queries con muchos binds.
// dateStrings: las fechas vuelven como string 'YYYY-MM-DD HH:MM:SS', sin
// conversión de zona sorpresa. timezone 'Z': se interpretan/emiten en UTC.
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  dateStrings: true,
  timezone: 'Z',
  namedPlaceholders: true,
  charset: 'utf8mb4',
});

module.exports = pool;
