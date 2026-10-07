// controllers/auditoria.controller.js
// Registro de actividad: quién hizo qué y cuándo (solo Administrativo).
const { sql, getPool } = require('../config/db');

// GET /api/auditoria?usuarioId=&tabla=&accion=&desde=&hasta=&buscar=
async function listar(req, res) {
  const f = req.query;
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('usuarioId', sql.Int, /^\d+$/.test(f.usuarioId || '') ? Number(f.usuarioId) : null)
      .input('tabla', sql.NVarChar, f.tabla || null)
      .input('accion', sql.NVarChar, f.accion || null)
      .input('desde', sql.Date, fecha(f.desde))
      .input('hasta', sql.Date, fecha(f.hasta))
      .input('buscar', sql.NVarChar, f.buscar ? `%${String(f.buscar).slice(0, 80)}%` : null)
      .query(`
        SELECT TOP 300 a.AuditoriaID, a.TablaAfectada, a.RegistroID, a.Accion, a.Detalle, a.FechaHora,
               a.UsuarioID, (per.Nombres + ' ' + per.Apellidos) AS Usuario, ro.NombreRol AS Rol
        FROM Auditoria a
        LEFT JOIN Usuarios u ON u.UsuarioID = a.UsuarioID
        LEFT JOIN Personas per ON per.PersonaID = u.PersonaID
        LEFT JOIN Roles ro ON ro.RolID = u.RolID
        WHERE (@usuarioId IS NULL OR a.UsuarioID = @usuarioId)
          AND (@tabla IS NULL OR a.TablaAfectada = @tabla)
          AND (@accion IS NULL OR a.Accion = @accion)
          AND (@desde IS NULL OR CAST(a.FechaHora AS DATE) >= @desde)
          AND (@hasta IS NULL OR CAST(a.FechaHora AS DATE) <= @hasta)
          AND (@buscar IS NULL OR a.Detalle LIKE @buscar)
        ORDER BY a.FechaHora DESC, a.AuditoriaID DESC
      `);
    const usuarios = (await pool.request().query(`
      SELECT DISTINCT a.UsuarioID, (per.Nombres + ' ' + per.Apellidos) AS Usuario
      FROM Auditoria a INNER JOIN Usuarios u ON u.UsuarioID = a.UsuarioID INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      ORDER BY Usuario`)).recordset;
    res.json({ registros: r.recordset, usuarios });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar el registro de actividad.' });
  }
}

module.exports = { listar };
