// controllers/citas.controller.js
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const {
  comoFechaLiteralUTC,
  rangoDeCita,
  validarHorarioClinica,
  hayChoqueDeHorario,
  hayChoqueDePaciente,
  hayChoqueDePropietario,
  validarDatosCita,
  conAgendaBloqueada,
  buscarVeterinarioDisponible,
} = require('../utils/horarios');

// GET /api/citas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve las citas dentro de ese rango (pensado para la semana visible
// en el calendario), con el nombre del paciente, dueño y veterinario.
async function listar(req, res) {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ mensaje: 'Faltan los parámetros desde y hasta.' });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('desde', sql.DateTime2, comoFechaLiteralUTC(`${desde}T00:00:00`))
      .input('hasta', sql.DateTime2, comoFechaLiteralUTC(`${hasta}T23:59:59`))
      .query(`
        SELECT c.CitaID, c.FechaHora, c.Motivo, c.TipoCita, c.Estado, c.MetodoPago,
               c.ClienteConfirmo, c.CanceladaPorCliente,
               p.PacienteID, p.Nombre AS PacienteNombre, p.FotoURL,
               pr.PropietarioID, pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos,
               pr.Telefono AS PropietarioTelefono,
               u.UsuarioID AS VeterinarioID, (per.Nombres + ' ' + per.Apellidos) AS VeterinarioNombre,
               (SELECT TOP 1 co.ConsultaID FROM Consultas co WHERE co.CitaID = c.CitaID) AS ConsultaID
        FROM Citas c
        INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
        INNER JOIN Propietarios pr ON pr.PropietarioID = c.PropietarioID
        LEFT JOIN Usuarios u ON u.UsuarioID = c.VeterinarioID
        LEFT JOIN Personas per ON per.PersonaID = u.PersonaID
        WHERE c.FechaHora BETWEEN @desde AND @hasta
        ORDER BY c.FechaHora ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar las citas.' });
  }
}

// POST /api/citas
// Body: { pacienteId, veterinarioId?, fechaHora, tipoCita, motivo, metodoPago }
//
// veterinarioId es OPCIONAL: si no se manda (o se manda vacío), el
// sistema busca solo, entre los veterinarios cuyo horario de trabajo
// cubre ese día/hora, uno que además no tenga otra cita cruzada, y lo
// asigna automáticamente. Si no encuentra a nadie, la cita se guarda
// igual pero sin veterinario (veterinarioAsignado: null en la
// respuesta) — un administrador deberá asignarlo a mano desde el
// modal de detalle en citas.html.
async function crear(req, res) {
  try {
    const { pacienteId, veterinarioId, fechaHora, tipoCita, motivo, metodoPago } = req.body;

    if (!pacienteId || !fechaHora || !tipoCita) {
      return res.status(400).json({ mensaje: 'Paciente, fecha/hora y tipo de cita son obligatorios.' });
    }

    const errorDatos = validarDatosCita({ fechaHora, tipoCita, metodoPago, motivo });
    if (errorDatos) {
      return res.status(400).json({ mensaje: errorDatos });
    }

    const errorHorario = validarHorarioClinica(fechaHora, tipoCita);
    if (errorHorario) {
      return res.status(400).json({ mensaje: errorHorario });
    }

    const pool = await getPool();

    const pacienteResult = await pool
      .request()
      .input('pacienteId', sql.Int, pacienteId)
      .query('SELECT PropietarioID, Activo FROM Pacientes WHERE PacienteID = @pacienteId');

    if (pacienteResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Paciente no encontrado.' });
    }
    if (!pacienteResult.recordset[0].Activo) {
      return res.status(400).json({ mensaje: 'Este paciente está desactivado. Actívalo antes de agendarle una cita.' });
    }
    const propietarioId = pacienteResult.recordset[0].PropietarioID;

    // Validaciones de choque + guardado con la agenda bloqueada (ver horarios.js)
    const resultado = await conAgendaBloqueada(pool, async (tx) => {
      // Esta mascota no puede tener otra cita a la misma hora, tenga o no
      // veterinario asignado todavía.
      const choquePaciente = await hayChoqueDePaciente(tx, pacienteId, fechaHora, tipoCita);
      if (choquePaciente) return { status: 409, mensaje: choquePaciente };

      // Ni el dueño a otra de sus mascotas.
      const choqueDuenio = await hayChoqueDePropietario(tx, propietarioId, pacienteId, fechaHora, tipoCita);
      if (choqueDuenio) return { status: 409, mensaje: choqueDuenio };

      let veterinarioIdFinal = veterinarioId || null;
      if (veterinarioIdFinal) {
        // El staff eligió un veterinario a mano: solo se revisa que no choque.
        const choque = await hayChoqueDeHorario(tx, veterinarioIdFinal, fechaHora, tipoCita);
        if (choque) return { status: 409, mensaje: choque };
      } else {
        // Nadie eligió veterinario: se busca uno automáticamente según su
        // horario de trabajo. Si no hay ninguno libre, queda sin asignar.
        veterinarioIdFinal = await buscarVeterinarioDisponible(tx, fechaHora, tipoCita);
      }

      const insert = await tx
        .request()
        .input('pacienteId', sql.Int, pacienteId)
        .input('propietarioId', sql.Int, propietarioId)
        .input('veterinarioId', sql.Int, veterinarioIdFinal)
        .input('fechaHora', sql.DateTime2, comoFechaLiteralUTC(fechaHora))
        .input('tipoCita', sql.NVarChar, tipoCita)
        .input('motivo', sql.NVarChar, motivo || null)
        .input('metodoPago', sql.NVarChar, metodoPago || null)
        .query(`
          INSERT INTO Citas (PacienteID, PropietarioID, VeterinarioID, FechaHora, TipoCita, Motivo, Estado, MetodoPago)
          OUTPUT INSERTED.CitaID
          VALUES (@pacienteId, @propietarioId, @veterinarioId, @fechaHora, @tipoCita, @motivo, 'Programada', @metodoPago)
        `);
      return { status: 201, citaId: insert.recordset[0].CitaID, veterinarioIdFinal };
    });

    if (resultado.status !== 201) {
      return res.status(resultado.status).json({ mensaje: resultado.mensaje });
    }
    await registrarAuditoria(pool, { tabla: 'Citas', registroId: resultado.citaId, accion: 'Crear', usuarioId: req.usuario.usuarioId, detalle: `Agendó una cita (${req.body.tipoCita}) para el ${String(req.body.fechaHora).replace('T', ' ')}` });
    res.status(201).json({
      mensaje: resultado.veterinarioIdFinal
        ? 'Cita agendada correctamente.'
        : 'Cita agendada, pero no hay ningún veterinario disponible en ese horario. Un administrador deberá asignarlo manualmente.',
      citaId: resultado.citaId,
      veterinarioAsignado: resultado.veterinarioIdFinal,
    });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ mensaje: err.status ? err.message : 'Error al agendar la cita.' });
  }
}

// PATCH /api/citas/:id/estado
// Body: { estado: 'Programada' | 'Confirmada' | 'Completada' | 'Cancelada', veterinarioId? }
// Si al confirmar se le asigna (o cambia) el veterinario, también se
// revisa que no choque con otra cita suya.
async function cambiarEstado(req, res) {
  try {
    const { id } = req.params;
    const { estado, veterinarioId } = req.body;

    // Completada = el cliente asistió; NoAsistio = faltó
    if (!['Programada', 'Confirmada', 'Completada', 'Cancelada', 'NoAsistio'].includes(estado)) {
      return res.status(400).json({ mensaje: 'Estado inválido.' });
    }

    const pool = await getPool();

    const resultado = await conAgendaBloqueada(pool, async (tx) => {
      const actual = await tx.request().input('id', sql.Int, id).query(`
        SELECT c.FechaHora, c.TipoCita, c.Estado, c.PacienteID, c.VeterinarioID, p.PropietarioID
        FROM Citas c INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
        WHERE c.CitaID = @id
      `);
      if (actual.recordset.length === 0) return { status: 404, mensaje: 'Cita no encontrada.' };
      const cita = actual.recordset[0];

      // No se puede dar por atendida una cita de un día que todavía no llega
      // (el mismo día sí, por si se atiende un poco antes de la hora).
      const hoyLima = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
      if (estado === 'Completada' && cita.FechaHora.toISOString().slice(0, 10) > hoyLima) {
        return { status: 400, mensaje: 'No puedes marcar como completada una cita de un día que todavía no llega.' };
      }

      // Asistencia: una cita que ya empezó se CIERRA (asistió / no asistió);
      // no se puede volver a programar, confirmar ni cancelar. Y "no asistió"
      // solo tiene sentido cuando ya llegó la hora. (Si solo se reasigna el
      // veterinario sin cambiar el estado, no se aplica.)
      const yaEmpezo = cita.FechaHora <= comoFechaLiteralUTC(new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 19));
      if (estado !== cita.Estado) {
        if (estado === 'NoAsistio' && !yaEmpezo) {
          return { status: 400, mensaje: 'Todavía no llega la hora de la cita: no se puede marcar que no asistió.' };
        }
        if (['Programada', 'Confirmada', 'Cancelada'].includes(estado) && yaEmpezo) {
          return { status: 400, mensaje: 'Esta cita ya pasó: ciérrala marcando si el cliente asistió o no asistió.' };
        }
      }

      // Reactivar una cita cancelada: mientras estuvo cancelada pudo agendarse
      // otra cosa en ese horario, así que se vuelven a revisar los choques.
      const reactivando = cita.Estado === 'Cancelada' && estado !== 'Cancelada';
      if (reactivando) {
        const choquePaciente = await hayChoqueDePaciente(tx, cita.PacienteID, cita.FechaHora, cita.TipoCita, id);
        if (choquePaciente) return { status: 409, mensaje: choquePaciente };
        const choqueDuenio = await hayChoqueDePropietario(tx, cita.PropietarioID, cita.PacienteID, cita.FechaHora, cita.TipoCita, { citaIdExcluir: id });
        if (choqueDuenio) return { status: 409, mensaje: choqueDuenio };
      }

      // Veterinario nuevo, o el que ya tenía si se está reactivando
      const vetARevisar = veterinarioId || (reactivando ? cita.VeterinarioID : null);
      if (vetARevisar && estado !== 'Cancelada') {
        const choque = await hayChoqueDeHorario(tx, vetARevisar, cita.FechaHora, cita.TipoCita, id);
        if (choque) return { status: 409, mensaje: choque };
      }

      await tx
        .request()
        .input('id', sql.Int, id)
        .input('estado', sql.NVarChar, estado)
        .input('veterinarioId', sql.Int, veterinarioId || null)
        .query(`
          UPDATE Citas
          SET Estado = @estado
              ${veterinarioId ? ', VeterinarioID = @veterinarioId' : ''}
          WHERE CitaID = @id
        `);
      return { status: 200 };
    });

    if (resultado.status !== 200) {
      return res.status(resultado.status).json({ mensaje: resultado.mensaje });
    }
    await registrarAuditoria(pool, { tabla: 'Citas', registroId: Number(id), accion: 'CambiarEstado', usuarioId: req.usuario.usuarioId, detalle: `Cita #${id}: estado -> ${estado}${veterinarioId ? ` (veterinario ID ${veterinarioId})` : ''}` });
    res.json({ mensaje: 'Estado actualizado.' });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ mensaje: err.status ? err.message : 'Error al actualizar el estado.' });
  }
}

// GET /api/citas/por-cerrar
// Citas que ya terminaron (según su duración) y siguen Programada/Confirmada:
// el personal debe marcar si el cliente asistió o no.
async function porCerrar(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT c.CitaID, c.FechaHora, c.TipoCita, c.Estado, c.Motivo,
             p.PacienteID, p.Nombre AS PacienteNombre,
             pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos, pr.Telefono
      FROM Citas c
      INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      INNER JOIN Propietarios pr ON pr.PropietarioID = c.PropietarioID
      WHERE c.Estado IN ('Programada', 'Confirmada')
        AND c.FechaHora < DATEADD(HOUR, -5, SYSUTCDATETIME())
      ORDER BY c.FechaHora
    `);
    const ahoraLima = comoFechaLiteralUTC(new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 19));
    res.json(result.recordset.filter((c) => rangoDeCita(c.FechaHora, c.TipoCita).fin <= ahoraLima));
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron revisar las citas por cerrar.' });
  }
}

module.exports = { listar, crear, cambiarEstado, porCerrar };