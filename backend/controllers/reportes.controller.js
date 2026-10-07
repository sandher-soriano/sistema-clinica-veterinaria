// controllers/reportes.controller.js
const { sql, getPool } = require('../config/db');
const { actualizarEstadosEsquemas } = require('../utils/estadoEsquemas');

// GET /api/reportes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
async function resumen(req, res) {
  try {
    const desde = req.query.desde || '2000-01-01';
    const hasta = req.query.hasta || '2100-01-01';

    const pool = await getPool();
    const request = () => pool
      .request()
      .input('desde', sql.DateTime2, `${desde}T00:00:00`)
      .input('hasta', sql.DateTime2, `${hasta}T23:59:59`);

    // --- Pacientes nuevos y consultas dentro del rango ---
    const pacientesResult = await request()
      .query('SELECT COUNT(*) AS Total FROM Pacientes WHERE FechaRegistro BETWEEN @desde AND @hasta');
    const consultasResult = await request()
      .query('SELECT COUNT(*) AS Total FROM Consultas WHERE FechaConsulta BETWEEN @desde AND @hasta');

    // --- Citas por estado dentro del rango (para tasa de asistencia) ---
    const citasResult = await request().query(`
      SELECT Estado, COUNT(*) AS Cantidad
      FROM Citas
      WHERE FechaHora BETWEEN @desde AND @hasta
      GROUP BY Estado
    `);
    const citasPorEstado = { Programada: 0, Confirmada: 0, Completada: 0, NoAsistio: 0, Cancelada: 0 };
    citasResult.recordset.forEach((r) => { citasPorEstado[r.Estado] = r.Cantidad; });
    const totalCitas = Object.values(citasPorEstado).reduce((a, b) => a + b, 0);
    // Asistencia real: de las citas ya cerradas, cuántas vinieron
    // (las futuras y las canceladas no cuentan).
    const cerradas = citasPorEstado.Completada + citasPorEstado.NoAsistio;
    const tasaAsistencia = cerradas > 0
      ? Math.round((citasPorEstado.Completada / cerradas) * 100)
      : 0;

    // --- Cobertura de vacunación: estado ACTUAL (no depende del rango de
    // fechas) — de cada paciente, se mira su vacuna aplicada más reciente.
    // Estados recalculados con la fecha de hoy (antes quedaban fijos al guardar
    // y la cobertura salía ~100% aunque hubiera refuerzos vencidos).
    await actualizarEstadosEsquemas(pool);
    const coberturaResult = await pool.request().query(`
      SELECT Estado FROM (
        SELECT e.PacienteID, e.Estado,
               ROW_NUMBER() OVER (PARTITION BY e.PacienteID ORDER BY e.FechaAplicacion DESC) AS rn
        FROM EsquemasPreventivos e
        INNER JOIN TiposEsquemaPreventivo t ON t.TipoEsquemaID = e.TipoEsquemaID
        INNER JOIN Pacientes p ON p.PacienteID = e.PacienteID AND p.Activo = 1
        WHERE t.NombreTipo = 'Vacuna' AND e.FechaAplicacion IS NOT NULL
      ) ultima
      WHERE rn = 1
    `);
    const totalConVacuna = coberturaResult.recordset.length;
    // "Al día" = su vacuna sigue vigente (también si el refuerzo vence en ≤30 días)
    const alDia = coberturaResult.recordset.filter((r) => r.Estado !== 'Atrasado').length;
    const coberturaVacunacion = totalConVacuna > 0 ? Math.round((alDia / totalConVacuna) * 100) : 0;

    // --- Top 5 motivos de consulta dentro del rango ---
    const motivosResult = await request().query(`
      SELECT TOP 5 MotivoConsulta, COUNT(*) AS Cantidad
      FROM Consultas
      WHERE FechaConsulta BETWEEN @desde AND @hasta
      GROUP BY MotivoConsulta
      ORDER BY COUNT(*) DESC
    `);

    res.json({
      totalPacientesNuevos: pacientesResult.recordset[0].Total,
      totalConsultas: consultasResult.recordset[0].Total,
      citasPorEstado,
      totalCitas,
      tasaAsistencia,
      coberturaVacunacion,
      totalConVacuna,
      topMotivos: motivosResult.recordset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al generar el reporte.' });
  }
}

module.exports = { resumen };
