const express = require('express');
const pool = require('../../db');

// /health — público, sin login. Sonda de "¿el servidor ya despertó?" (mismo
// uso que en el sistema de asistencia con Render/Clever cold starts) y
// chequeo de conectividad a la base.
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

router.get('/db', async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT 1 AS ok');
    res.json({ ok: row.ok === 1 });
  } catch (err) {
    req.log?.error('health_db_failed', { message: err.message });
    res.status(503).json({ ok: false, error: 'Sin conexión a la base.' });
  }
});

module.exports = router;
