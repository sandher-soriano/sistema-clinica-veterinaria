// controllers/notificacionesApp.controller.js
// Recordatorios que la APP del cliente muestra como notificación del celular,
// aunque la app esté cerrada (lo hace el "runner" en segundo plano:
// premiercan-app-clientes/www/runners/promociones.js).
const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../config/db');
const { pendientesParaApp, confirmarEnApp } = require('../utils/recordatorios-auto');

const DURACION_TOKEN = '180d';

// POST /api/cliente/app/token-notificaciones  (con la sesión normal del cliente)
// Devuelve un token de larga duración que SOLO sirve para leer sus recordatorios.
function tokenNotificacionesApp(req, res) {
  const token = jwt.sign(
    { tipo: 'notif-app', propietarioId: req.propietario.propietarioId },
    process.env.JWT_SECRET,
    { expiresIn: DURACION_TOKEN },
  );
  res.json({ token });
}

// GET /api/cliente/app/notificaciones  (token de notificaciones)
async function notificacionesApp(req, res) {
  try {
    const pool = await getPool();
    res.json(await pendientesParaApp(pool, req.propietario.propietarioId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron obtener los recordatorios.' });
  }
}

// POST /api/cliente/app/notificaciones/confirmar  { ids: [RecordatorioID, ...] }
async function confirmarNotificacionesApp(req, res) {
  try {
    const pool = await getPool();
    const confirmados = await confirmarEnApp(pool, req.propietario.propietarioId, req.body && req.body.ids);
    res.json({ confirmados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo confirmar.' });
  }
}

// GET /api/cliente/avisos  (sesión normal del cliente)
// Bandeja "Mis avisos": los avisos personalizados que la clínica le mandó
// (los ya enviados o cuya hora de envío ya llegó), del más nuevo al más viejo.
async function misAvisos(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('propietarioId', sql.Int, req.propietario.propietarioId)
      .query(`
        SELECT TOP 50 RecordatorioID, Titulo, Mensaje, ISNULL(EnviadoEn, EnviarDesde) AS Fecha
        FROM Recordatorios
        WHERE PropietarioID = @propietarioId AND TipoRecordatorio = 'Aviso' AND Destino = 'Cliente'
          AND Estado <> 'Fallido'
          AND (Estado = 'Enviado' OR EnviarDesde <= DATEADD(HOUR, -5, SYSUTCDATETIME()))
        ORDER BY ISNULL(EnviadoEn, EnviarDesde) DESC
      `);
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron cargar tus avisos.' });
  }
}

module.exports = { tokenNotificacionesApp, notificacionesApp, confirmarNotificacionesApp, misAvisos };
