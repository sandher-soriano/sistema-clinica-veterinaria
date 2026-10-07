// controllers/dashboard.controller.js
const { sql, getPool } = require('../config/db');
const { actualizarEstadosEsquemas } = require('../utils/estadoEsquemas');

const DIAS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function lunesDeEsaSemana(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const diaSemana = d.getDay();
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + diff);
  return d;
}
function fechaISO(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// GET /api/dashboard
// Todo lo que necesita el dashboard en una sola llamada: las 4 tarjetas
// resumen (reutilizando la vista vw_ResumenDashboard), citas de la semana
// actual (para el gráfico de barras) y las últimas historias clínicas.
async function resumen(req, res) {
  try {
    const pool = await getPool();

    await actualizarEstadosEsquemas(pool); // vacunas vencidas -> "Atrasado" con la fecha de hoy
    const tarjetasResult = await pool.request().query('SELECT * FROM vw_ResumenDashboard');
    const tarjetas = tarjetasResult.recordset[0];

    const inicioSemana = lunesDeEsaSemana(new Date());
    const finSemana = new Date(inicioSemana);
    finSemana.setDate(finSemana.getDate() + 6);

    const citasSemanaResult = await pool
      .request()
      .input('desde', sql.DateTime2, `${fechaISO(inicioSemana)}T00:00:00`)
      .input('hasta', sql.DateTime2, `${fechaISO(finSemana)}T23:59:59`)
      .query(`
        SELECT CAST(FechaHora AS DATE) AS Dia, COUNT(*) AS Cantidad
        FROM Citas
        WHERE FechaHora BETWEEN @desde AND @hasta
        GROUP BY CAST(FechaHora AS DATE)
      `);

    // Se arma un array de 7 días (Lun..Dom) rellenando con 0 los días sin citas
    const citasPorSemana = DIAS_ES.map((label, i) => {
      const dia = new Date(inicioSemana);
      dia.setDate(dia.getDate() + i);
      const diaIso = fechaISO(dia);
      const fila = citasSemanaResult.recordset.find(
        (r) => fechaISO(new Date(r.Dia)) === diaIso
      );
      return { dia: label, cantidad: fila ? fila.Cantidad : 0 };
    });

    const historiasResult = await pool.request().query(`
      SELECT TOP 5 c.ConsultaID, c.FechaConsulta, c.MotivoConsulta,
             p.Nombre AS PacienteNombre, pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos
      FROM Consultas c
      INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
      ORDER BY c.FechaConsulta DESC
    `);

    res.json({
      tarjetas,
      citasPorSemana,
      ultimasHistorias: historiasResult.recordset,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al cargar el dashboard.' });
  }
}

module.exports = { resumen };
