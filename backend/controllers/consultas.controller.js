// controllers/consultas.controller.js
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');

// GET /api/consultas?pacienteId=X
// Historial de consultas de un paciente, con nombre del veterinario y
// los medicamentos recetados en cada una.
async function listarPorPaciente(req, res) {
  try {
    const { pacienteId } = req.query;
    if (!pacienteId) {
      return res.status(400).json({ mensaje: 'Falta el parámetro pacienteId.' });
    }

    const pool = await getPool();

    const consultasResult = await pool
      .request()
      .input('pacienteId', sql.Int, pacienteId)
      .query(`
        SELECT c.ConsultaID, c.FechaConsulta, c.MotivoConsulta, c.Sintomas,
               c.Diagnostico, c.Tratamiento, c.Observaciones, c.PesoKg, c.TemperaturaC,
               (per.Nombres + ' ' + per.Apellidos) AS VeterinarioNombre
        FROM Consultas c
        INNER JOIN Usuarios u ON u.UsuarioID = c.VeterinarioID
        INNER JOIN Personas per ON per.PersonaID = u.PersonaID
        WHERE c.PacienteID = @pacienteId
        ORDER BY c.FechaConsulta DESC
      `);

    const consultas = consultasResult.recordset;

    if (consultas.length > 0) {
      const ids = consultas.map((c) => c.ConsultaID);
      const medsResult = await pool.request().query(`
        SELECT cm.ConsultaID, m.NombreMedicamento, cm.Dosis, cm.Frecuencia, cm.DuracionDias
        FROM ConsultaMedicamentos cm
        INNER JOIN Medicamentos m ON m.MedicamentoID = cm.MedicamentoID
        WHERE cm.ConsultaID IN (${ids.join(',')})
      `);
      consultas.forEach((c) => {
        c.Medicamentos = medsResult.recordset.filter((m) => m.ConsultaID === c.ConsultaID);
      });
    }

    res.json(consultas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener el historial de consultas.' });
  }
}

// POST /api/consultas
// Body:
// {
//   pacienteId, veterinarioId, fechaConsulta, motivoConsulta, sintomas, diagnostico,
//   tratamiento, observaciones,
//   medicamentos: [{ nombre, dosis, frecuencia, duracionDias }]
// }
// "veterinarioId" es el que el usuario elige en el select "Veterinario
// Responsable" del formulario. Si no llega (por compatibilidad con
// versiones viejas del front), se usa como respaldo el usuario logueado.
async function crear(req, res) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    const {
      pacienteId, veterinarioId, fechaConsulta, motivoConsulta, sintomas,
      diagnostico, tratamiento, observaciones, medicamentos, citaId,
    } = req.body;

    if (!pacienteId || !motivoConsulta) {
      return res.status(400).json({ mensaje: 'El paciente y el motivo de consulta son obligatorios.' });
    }

    // Signos (opcionales): peso en kg y temperatura en °C, con rangos razonables
    const numero = (v) => (v === undefined || v === null || v === '' ? null : Number(String(v).replace(',', '.')));
    const pesoKg = numero(req.body.pesoKg);
    const temperaturaC = numero(req.body.temperaturaC);
    if (pesoKg !== null && !(pesoKg > 0 && pesoKg <= 200)) {
      return res.status(400).json({ mensaje: 'El peso debe estar entre 0.01 y 200 kg.' });
    }
    if (temperaturaC !== null && !(temperaturaC >= 30 && temperaturaC <= 45)) {
      return res.status(400).json({ mensaje: 'La temperatura debe estar entre 30 y 45 °C.' });
    }

    await transaction.begin();

    // Consulta registrada desde "Atender" en una cita: se valida la cita y,
    // al guardar, la cita queda Completada en la MISMA transacción.
    if (citaId) {
      const citaResult = await new sql.Request(transaction)
        .input('citaId', sql.Int, citaId)
        .query(`
          SELECT c.PacienteID, c.Estado, c.FechaHora,
                 (SELECT COUNT(*) FROM Consultas WHERE CitaID = c.CitaID) AS YaTieneConsulta
          FROM Citas c WITH (UPDLOCK, ROWLOCK)
          WHERE c.CitaID = @citaId
        `);
      const cita = citaResult.recordset[0];
      let error = null;
      if (!cita) error = [404, 'La cita no existe.'];
      else if (cita.PacienteID !== Number(pacienteId)) error = [400, 'Esa cita es de otra mascota.'];
      else if (cita.Estado === 'Cancelada') error = [400, 'Esa cita está cancelada: no se puede atender.'];
      else if (cita.YaTieneConsulta || cita.Estado === 'Completada') error = [409, 'Esa cita ya fue atendida y tiene su consulta registrada.'];
      else {
        const hoyLima = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
        if (cita.FechaHora.toISOString().slice(0, 10) > hoyLima) error = [400, 'Esa cita es de un día que todavía no llega: no se puede atender aún.'];
      }
      if (error) {
        await transaction.rollback();
        return res.status(error[0]).json({ mensaje: error[1] });
      }
    }

    const insertConsulta = await new sql.Request(transaction)
      .input('citaId', sql.Int, citaId || null)
      .input('pacienteId', sql.Int, pacienteId)
      .input('veterinarioId', sql.Int, veterinarioId || req.usuario.usuarioId)
      .input('fechaConsulta', sql.DateTime2, fechaConsulta || new Date())
      .input('motivoConsulta', sql.NVarChar, motivoConsulta)
      .input('sintomas', sql.NVarChar, sintomas || null)
      .input('diagnostico', sql.NVarChar, diagnostico || null)
      .input('tratamiento', sql.NVarChar, tratamiento || null)
      .input('observaciones', sql.NVarChar, observaciones || null)
      .input('pesoKg', sql.Decimal(6, 2), pesoKg)
      .input('temperaturaC', sql.Decimal(4, 1), temperaturaC)
      .query(`
        INSERT INTO Consultas (PacienteID, VeterinarioID, FechaConsulta, MotivoConsulta, Sintomas, Diagnostico, Tratamiento, Observaciones, CitaID, PesoKg, TemperaturaC)
        OUTPUT INSERTED.ConsultaID
        VALUES (@pacienteId, @veterinarioId, @fechaConsulta, @motivoConsulta, @sintomas, @diagnostico, @tratamiento, @observaciones, @citaId, @pesoKg, @temperaturaC)
      `);

    const consultaId = insertConsulta.recordset[0].ConsultaID;

    if (citaId) {
      // La cita queda atendida, y con el veterinario que la atendió de verdad.
      await new sql.Request(transaction)
        .input('citaId', sql.Int, citaId)
        .input('veterinarioId', sql.Int, veterinarioId || req.usuario.usuarioId)
        .query("UPDATE Citas SET Estado = 'Completada', VeterinarioID = @veterinarioId WHERE CitaID = @citaId");
    }

    for (const med of (medicamentos || [])) {
      if (!med.nombre) continue;

      const existente = await new sql.Request(transaction)
        .input('nombre', sql.NVarChar, med.nombre)
        .query('SELECT MedicamentoID FROM Medicamentos WHERE NombreMedicamento = @nombre');

      let medicamentoId;
      if (existente.recordset.length > 0) {
        medicamentoId = existente.recordset[0].MedicamentoID;
      } else {
        const nuevo = await new sql.Request(transaction)
          .input('nombre', sql.NVarChar, med.nombre)
          .query('INSERT INTO Medicamentos (NombreMedicamento) OUTPUT INSERTED.MedicamentoID VALUES (@nombre)');
        medicamentoId = nuevo.recordset[0].MedicamentoID;
      }

      await new sql.Request(transaction)
        .input('consultaId', sql.Int, consultaId)
        .input('medicamentoId', sql.Int, medicamentoId)
        .input('dosis', sql.NVarChar, med.dosis || null)
        .input('frecuencia', sql.NVarChar, med.frecuencia || null)
        .input('duracionDias', sql.Int, med.duracionDias || null)
        .query(`
          INSERT INTO ConsultaMedicamentos (ConsultaID, MedicamentoID, Dosis, Frecuencia, DuracionDias)
          VALUES (@consultaId, @medicamentoId, @dosis, @frecuencia, @duracionDias)
        `);
    }

    await transaction.commit();
    await registrarAuditoria(pool, { tabla: 'Consultas', registroId: consultaId, accion: 'Crear', usuarioId: req.usuario.usuarioId, detalle: `Registró consulta de paciente #${pacienteId}: ${motivoConsulta}${citaId ? ` (cita #${citaId})` : ''}` });
    res.status(201).json({
      mensaje: citaId ? 'Consulta registrada y cita marcada como atendida.' : 'Consulta registrada correctamente.',
      consultaId,
    });
  } catch (err) {
    console.error(err);
    try { await transaction.rollback(); } catch (_) { /* ya estaba cerrada */ }
    res.status(500).json({ mensaje: 'Error al registrar la consulta.' });
  }
}

/**
 * Datos de la receta de una consulta (membrete, mascota, dueño, veterinario y
 * medicamentos). propietarioId: si viene, la consulta debe ser de una mascota
 * de ese dueño (uso desde el portal de clientes).
 */
async function datosReceta(pool, consultaId, propietarioId = null) {
  const r = await pool.request()
    .input('id', sql.Int, consultaId)
    .input('propietarioId', sql.Int, propietarioId)
    .query(`
      SELECT c.ConsultaID, c.FechaConsulta, c.MotivoConsulta, c.Diagnostico, c.Tratamiento, c.Observaciones,
             c.PesoKg, c.TemperaturaC,
             p.Nombre AS PacienteNombre, p.Especie, p.Raza, p.Sexo, p.FechaNacimiento, p.Alergias,
             pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos, pr.NumeroDocumento AS PropietarioDNI,
             (per.Nombres + ' ' + per.Apellidos) AS VeterinarioNombre
      FROM Consultas c
      INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
      INNER JOIN Usuarios u ON u.UsuarioID = c.VeterinarioID
      INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      WHERE c.ConsultaID = @id AND (@propietarioId IS NULL OR p.PropietarioID = @propietarioId)
    `);
  const consulta = r.recordset[0];
  if (!consulta) return null;
  consulta.Medicamentos = (await pool.request().input('id', sql.Int, consultaId).query(`
    SELECT m.NombreMedicamento, cm.Dosis, cm.Frecuencia, cm.DuracionDias
    FROM ConsultaMedicamentos cm INNER JOIN Medicamentos m ON m.MedicamentoID = cm.MedicamentoID
    WHERE cm.ConsultaID = @id ORDER BY cm.ConsultaMedicamentoID
  `)).recordset;
  return consulta;
}

// GET /api/consultas/:id/receta (personal)
async function receta(req, res) {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ mensaje: 'Consulta inválida.' });
    const datos = await datosReceta(await getPool(), Number(req.params.id));
    if (!datos) return res.status(404).json({ mensaje: 'Consulta no encontrada.' });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar la receta.' });
  }
}

module.exports = { listarPorPaciente, crear, receta, datosReceta };