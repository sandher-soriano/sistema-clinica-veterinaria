// controllers/clienteApp.controller.js
//
// Todo aquí filtra SIEMPRE por el propietarioId que viene del token
// (req.propietario.propietarioId) — nunca por un id que mande el
// cliente en la URL. Así un cliente jamás puede ver mascotas de otro,
// aunque intente adivinar un número de paciente en la URL.
const { sql, getPool } = require('../config/db');
const {
  comoFechaLiteralUTC,
  validarHorarioClinica,
  hayChoqueDePaciente,
  hayChoqueDePropietario,
  validarDatosCita,
  conAgendaBloqueada,
  disponibilidadVeterinarios,
  horariosLibresCercanos,
} = require('../utils/horarios');

// GET /api/cliente/mascotas
async function misMascotas(req, res) {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('propietarioId', sql.Int, req.propietario.propietarioId)
      .query(`
        SELECT PacienteID, Nombre, Especie, Raza, FechaNacimiento, Sexo, FotoURL, Alergias
        FROM Pacientes
        WHERE PropietarioID = @propietarioId AND Activo = 1
        ORDER BY Nombre
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar tus mascotas.' });
  }
}

// ------------------------------------------------------------------
// Registrar mascota desde el portal
// La mascota queda a nombre del propietario del token (nunca de otro), marcada
// como "registrada por el cliente" y se avisa al personal para que revise los
// datos en la primera visita.
// ------------------------------------------------------------------
const ESPECIES = ['Canino', 'Felino', 'Otro'];
const MAX_MASCOTAS = 15;      // activas por propietario
const MAX_ALTAS_DIA = 5;      // registros por día (evita abusos)

function validarMascota(b) {
  const nombre = String(b.nombre || '').trim().replace(/\s+/g, ' ');
  if (!nombre) return { error: 'Escribe el nombre de tu mascota.' };
  if (nombre.length > 100 || !/^[\p{L}\p{M}0-9 .'’-]+$/u.test(nombre)) return { error: 'El nombre solo puede tener letras, números, espacios y guiones.' };
  if (!ESPECIES.includes(b.especie)) return { error: 'Elige si es perro, gato u otro.' };
  const raza = String(b.raza || '').trim().slice(0, 80) || null;
  if (b.especie === 'Otro' && !raza) return { error: 'Cuéntanos qué animal es (ej. conejo, hámster, loro).' };
  const sexo = b.sexo === 'M' || b.sexo === 'H' ? b.sexo : null;
  let fecha = null;
  if (b.fechaNacimiento) {
    fecha = String(b.fechaNacimiento);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) return { error: 'La fecha de nacimiento no es válida.' };
    const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    if (fecha > hoy) return { error: 'La fecha de nacimiento no puede ser futura.' };
    if (fecha < `${Number(hoy.slice(0, 4)) - 35}${hoy.slice(4)}`) return { error: 'Revisa la fecha de nacimiento (parece demasiado antigua).' };
  }
  const alergias = String(b.alergias || '').trim().slice(0, 500) || null;
  return { datos: { nombre, especie: b.especie, raza, sexo, fecha, alergias } };
}

// POST /api/cliente/mascotas  { nombre, especie, raza?, sexo?, fechaNacimiento?, alergias? }
async function registrarMascota(req, res) {
  const { datos, error } = validarMascota(req.body || {});
  if (error) return res.status(400).json({ mensaje: error });
  const propietarioId = req.propietario.propietarioId;
  try {
    const pool = await getPool();
    const c = (await pool.request().input('p', sql.Int, propietarioId).input('n', sql.NVarChar(100), datos.nombre).query(`
      SELECT (SELECT COUNT(*) FROM Pacientes WHERE PropietarioID = @p AND Activo = 1) AS Activas,
             (SELECT COUNT(*) FROM Pacientes WHERE PropietarioID = @p AND RegistradoPorCliente = 1
                AND FechaRegistro >= DATEADD(DAY, -1, SYSDATETIME())) AS AltasHoy,
             (SELECT COUNT(*) FROM Pacientes WHERE PropietarioID = @p AND Activo = 1 AND Nombre = @n) AS MismoNombre`)).recordset[0];
    if (c.MismoNombre) return res.status(409).json({ mensaje: `Ya tienes una mascota llamada "${datos.nombre}".` });
    if (c.Activas >= MAX_MASCOTAS) return res.status(400).json({ mensaje: 'Llegaste al máximo de mascotas en el portal. Para registrar más, comunícate con la clínica.' });
    if (c.AltasHoy >= MAX_ALTAS_DIA) return res.status(429).json({ mensaje: 'Ya registraste varias mascotas hoy. Inténtalo mañana o comunícate con la clínica.' });

    const r = await pool.request()
      .input('p', sql.Int, propietarioId).input('nombre', sql.NVarChar(100), datos.nombre).input('especie', sql.NVarChar(50), datos.especie)
      .input('raza', sql.NVarChar(80), datos.raza).input('fecha', sql.Date, datos.fecha).input('sexo', sql.Char(1), datos.sexo).input('alergias', sql.NVarChar(500), datos.alergias)
      .query(`INSERT INTO Pacientes (PropietarioID, Nombre, Especie, Raza, FechaNacimiento, Sexo, Alergias, RegistradoPorCliente)
              OUTPUT INSERTED.PacienteID VALUES (@p, @nombre, @especie, @raza, @fecha, @sexo, @alergias, 1)`);
    const pacienteId = r.recordset[0].PacienteID;

    // Alerta interna: el personal revisa la ficha en la primera visita
    const tipo = { Canino: 'perro', Felino: 'gato' }[datos.especie] || (datos.raza || 'mascota');
    await pool.request().input('pac', sql.Int, pacienteId).input('p', sql.Int, propietarioId)
      .input('m', sql.NVarChar, `${req.propietario.nombreCompleto} registró desde el portal a su ${tipo} "${datos.nombre}"${datos.especie !== 'Otro' && datos.raza ? ` (${datos.raza})` : ''}. Revisa sus datos en la primera visita.`)
      .query(`INSERT INTO Recordatorios (PacienteID, PropietarioID, TipoRecordatorio, FechaProgramada, Canal, Estado, Mensaje, Destino)
              VALUES (@pac, @p, 'Aviso', SYSDATETIME(), 'Push', 'Pendiente', @m, 'Staff')`);
    res.status(201).json({ mensaje: `¡${datos.nombre} ya está registrado! Ahora puedes agendarle citas.`, pacienteId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo registrar a tu mascota.' });
  }
}

// POST /api/cliente/mascotas/:id/foto  (multipart, campo "foto") — solo sus propias mascotas
async function fotoMascota(req, res) {
  const fs = require('fs');
  const borrar = () => { if (req.file) fs.unlink(req.file.path, () => {}); };
  try {
    if (!req.file) return res.status(400).json({ mensaje: 'No se recibió ninguna imagen.' });
    const pool = await getPool();
    const fotoUrl = `/uploads/pacientes/${req.file.filename}`;
    const r = await pool.request().input('id', sql.Int, req.params.id).input('p', sql.Int, req.propietario.propietarioId).input('f', sql.NVarChar(300), fotoUrl)
      .query('UPDATE Pacientes SET FotoURL = @f OUTPUT DELETED.FotoURL AS Anterior WHERE PacienteID = @id AND PropietarioID = @p AND Activo = 1');
    if (!r.recordset.length) { borrar(); return res.status(404).json({ mensaje: 'Mascota no encontrada.' }); }
    res.json({ mensaje: 'Foto actualizada.', fotoUrl });
  } catch (err) {
    borrar();
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo guardar la foto.' });
  }
}

// Verifica que el paciente pedido de verdad sea de este propietario.
// Se usa antes de mostrar historial o esquemas de una mascota puntual.
async function verificarPropiedad(pool, pacienteId, propietarioId) {
  const result = await pool
    .request()
    .input('pacienteId', sql.Int, pacienteId)
    .input('propietarioId', sql.Int, propietarioId)
    .query('SELECT PacienteID, Nombre, Especie, Raza, FechaNacimiento, Sexo, FotoURL, Alergias FROM Pacientes WHERE PacienteID = @pacienteId AND PropietarioID = @propietarioId AND Activo = 1');
  return result.recordset[0];
}

// GET /api/cliente/mascotas/:id
async function detalleMascota(req, res) {
  try {
    const pool = await getPool();
    const paciente = await verificarPropiedad(pool, req.params.id, req.propietario.propietarioId);
    if (!paciente) return res.status(404).json({ mensaje: 'Mascota no encontrada.' });
    res.json(paciente);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener la mascota.' });
  }
}

// GET /api/cliente/mascotas/:id/historial  (solo lectura)
async function historialMascota(req, res) {
  try {
    const pool = await getPool();
    const paciente = await verificarPropiedad(pool, req.params.id, req.propietario.propietarioId);
    if (!paciente) return res.status(404).json({ mensaje: 'Mascota no encontrada.' });

    const consultasResult = await pool
      .request()
      .input('pacienteId', sql.Int, req.params.id)
      .query(`
        SELECT c.ConsultaID, c.FechaConsulta, c.MotivoConsulta, c.Diagnostico, c.Tratamiento, c.Observaciones,
               c.PesoKg, c.TemperaturaC,
               (SELECT COUNT(*) FROM ConsultaMedicamentos cm WHERE cm.ConsultaID = c.ConsultaID) AS CantidadMedicamentos,
               (per.Nombres + ' ' + per.Apellidos) AS VeterinarioNombre
        FROM Consultas c
        INNER JOIN Usuarios u ON u.UsuarioID = c.VeterinarioID
        INNER JOIN Personas per ON per.PersonaID = u.PersonaID
        WHERE c.PacienteID = @pacienteId
        ORDER BY c.FechaConsulta DESC
      `);

    res.json(consultasResult.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener el historial.' });
  }
}

// GET /api/cliente/mascotas/:id/esquemas  (solo lectura)
async function esquemasMascota(req, res) {
  try {
    const pool = await getPool();
    const paciente = await verificarPropiedad(pool, req.params.id, req.propietario.propietarioId);
    if (!paciente) return res.status(404).json({ mensaje: 'Mascota no encontrada.' });

    const result = await pool
      .request()
      .input('pacienteId', sql.Int, req.params.id)
      .query(`
        SELECT e.NombreProducto, e.FechaAplicacion, e.FechaProximaDosis, e.Estado, t.NombreTipo AS TipoEsquema
        FROM EsquemasPreventivos e
        INNER JOIN TiposEsquemaPreventivo t ON t.TipoEsquemaID = e.TipoEsquemaID
        WHERE e.PacienteID = @pacienteId
        ORDER BY COALESCE(e.FechaAplicacion, e.FechaProximaDosis) DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener los esquemas preventivos.' });
  }
}

// GET /api/cliente/citas
// Todas las citas del propietario logueado (de cualquiera de sus mascotas).
async function misCitas(req, res) {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('propietarioId', sql.Int, req.propietario.propietarioId)
      .query(`
        SELECT c.CitaID, c.FechaHora, c.Motivo, c.TipoCita, c.Estado,
               c.ClienteConfirmo, c.CanceladaPorCliente,
               (SELECT e.Puntuacion FROM Encuestas e WHERE e.CitaID = c.CitaID) AS MiPuntuacion,
               p.PacienteID, p.Nombre AS PacienteNombre,
               (per.Nombres + ' ' + per.Apellidos) AS VeterinarioNombre
        FROM Citas c
        INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
        LEFT JOIN Usuarios u ON u.UsuarioID = c.VeterinarioID
        LEFT JOIN Personas per ON per.PersonaID = u.PersonaID
        WHERE c.PropietarioID = @propietarioId
        ORDER BY c.FechaHora DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar tus citas.' });
  }
}

// POST /api/cliente/citas
// Body: { pacienteId, fechaHora, tipoCita, motivo }
// La cita SIEMPRE queda como "Programada" — el cliente nunca la
// auto-confirma, eso lo hace el staff desde el panel.
async function solicitarCita(req, res) {
  try {
    const { pacienteId, fechaHora, tipoCita, motivo, metodoPago } = req.body;

    if (!pacienteId || !fechaHora || !tipoCita) {
      return res.status(400).json({ mensaje: 'Mascota, fecha/hora y tipo de cita son obligatorios.' });
    }

    const errorDatos = validarDatosCita({ fechaHora, tipoCita, metodoPago, motivo }, { paraCliente: true });
    if (errorDatos) {
      return res.status(400).json({ mensaje: errorDatos });
    }

    const errorHorario = validarHorarioClinica(fechaHora, tipoCita);
    if (errorHorario) {
      return res.status(400).json({ mensaje: errorHorario });
    }

    const pool = await getPool();
    const propietarioId = req.propietario.propietarioId;

    // Verifica que la mascota sea de verdad del propietario logueado —
    // igual que en historial/esquemas, nunca confiar solo en lo que
    // manda el cliente desde el navegador.
    const paciente = await verificarPropiedad(pool, pacienteId, propietarioId);
    if (!paciente) {
      return res.status(404).json({ mensaje: 'Esa mascota no existe o no te pertenece.' });
    }

    // Validaciones de choque + guardado, con la agenda bloqueada: así un
    // doble clic o dos pedidos a la vez no pueden crear citas que se pisen.
    const resultado = await conAgendaBloqueada(pool, async (tx) => {
      // Esta mascota no puede tener otra cita a la misma hora.
      const choquePaciente = await hayChoqueDePaciente(tx, pacienteId, fechaHora, tipoCita);
      if (choquePaciente) return { status: 409, mensaje: choquePaciente };

      // Y el dueño tampoco puede tener a OTRA de sus mascotas a esa hora.
      const choqueDuenio = await hayChoqueDePropietario(tx, propietarioId, pacienteId, fechaHora, tipoCita, { paraCliente: true });
      if (choqueDuenio) return { status: 409, mensaje: choqueDuenio };

      // El cliente nunca elige veterinario: se busca uno automáticamente según
      // su horario de trabajo. Si no hay ninguno libre, desde el portal NO se
      // agenda (antes quedaba "sin asignar" y se sobrecargaba la agenda): se le
      // dice que el horario está ocupado y se le sugieren horarios libres.
      // OJO: "motivoNoDisponible" (por qué no hay veterinario) NO es el "motivo"
      // de la cita que escribió el cliente; antes se llamaban igual y el del
      // cliente se perdía (las citas del portal quedaban sin motivo).
      const { veterinarioId: veterinarioIdFinal, motivo: motivoNoDisponible } = await disponibilidadVeterinarios(tx, fechaHora, tipoCita);
      if (!veterinarioIdFinal) {
        const sugerencias = await horariosLibresCercanos(tx, fechaHora, tipoCita, { pacienteId, propietarioId });
        const base = motivoNoDisponible === 'sin_horario'
          ? 'A esa hora no atiende ningún veterinario.'
          : 'Ese horario ya está ocupado.';
        return {
          status: 409,
          mensaje: sugerencias.length
            ? `${base} Horarios libres ese día: ${sugerencias.join(', ')}.`
            : `${base} Ese día ya no quedan horarios libres: prueba con otra fecha.`,
          sugerencias,
        };
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

      // Aviso automático para el staff: aparece en Recordatorios como algo
      // pendiente de revisar, para que no se les pase una cita nueva pedida
      // desde el portal de clientes.
      const fechaTexto = comoFechaLiteralUTC(fechaHora).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
      const horaTexto = String(fechaHora).substring(11, 16);
      await tx
        .request()
        .input('pacienteId', sql.Int, pacienteId)
        .input('propietarioId', sql.Int, propietarioId)
        .input('mensaje', sql.NVarChar, `${req.propietario.nombreCompleto} solicitó una cita para ${paciente.Nombre} el ${fechaTexto} a las ${horaTexto}. Revisar y confirmar en Citas.`)
        .query(`
          INSERT INTO Recordatorios (PacienteID, PropietarioID, TipoRecordatorio, FechaProgramada, Canal, Estado, Mensaje, Destino)
          VALUES (@pacienteId, @propietarioId, 'Cita', SYSDATETIME(), 'Push', 'Pendiente', @mensaje, 'Staff')
        `);

      return { status: 201, citaId: insert.recordset[0].CitaID };
    });

    if (resultado.status !== 201) {
      return res.status(resultado.status).json({ mensaje: resultado.mensaje, sugerencias: resultado.sugerencias });
    }
    res.status(201).json({ mensaje: 'Tu cita quedó registrada. La clínica la confirmará pronto.', citaId: resultado.citaId });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ mensaje: err.status ? err.message : 'Error al solicitar la cita.' });
  }
}

// ------------------------------------------------------------------
// El cliente responde a su cita desde el portal / la app
// ------------------------------------------------------------------
const HORAS_MIN_CANCELAR = 2;

// Cita del propio cliente, todavía vigente (futura y Programada/Confirmada)
async function citaPropiaVigente(pool, citaId, propietarioId) {
  const r = await pool.request()
    .input('id', sql.Int, citaId)
    .input('propietarioId', sql.Int, propietarioId)
    .query(`
      SELECT c.CitaID, c.Estado, c.FechaHora, c.PacienteID, p.Nombre AS PacienteNombre,
             DATEDIFF(MINUTE, DATEADD(HOUR, -5, SYSUTCDATETIME()), c.FechaHora) AS MinutosFaltan
      FROM Citas c INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      WHERE c.CitaID = @id AND c.PropietarioID = @propietarioId
    `);
  return r.recordset[0] || null;
}

function textoFechaCita(fechaHora) {
  const f = new Date(fechaHora);
  const fecha = f.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const hora = `${String(f.getUTCHours()).padStart(2, '0')}:${String(f.getUTCMinutes()).padStart(2, '0')}`;
  return `${fecha} a las ${hora}`;
}

async function avisarAlPersonal(pool, cita, propietario, mensaje) {
  await pool.request()
    .input('pacienteId', sql.Int, cita.PacienteID)
    .input('propietarioId', sql.Int, propietario.propietarioId)
    .input('citaId', sql.Int, cita.CitaID)
    .input('mensaje', sql.NVarChar, mensaje)
    .query(`
      INSERT INTO Recordatorios (PacienteID, PropietarioID, TipoRecordatorio, FechaProgramada, Canal, Estado, Mensaje, Destino)
      VALUES (@pacienteId, @propietarioId, 'Cita', SYSDATETIME(), 'Push', 'Pendiente', @mensaje, 'Staff')
    `);
}

// POST /api/cliente/citas/:id/confirmar  -> "Asistiré" (no cambia el Estado de la clínica)
async function confirmarMiCita(req, res) {
  try {
    const pool = await getPool();
    const cita = await citaPropiaVigente(pool, req.params.id, req.propietario.propietarioId);
    if (!cita) return res.status(404).json({ mensaje: 'No encontramos esa cita.' });
    if (!['Programada', 'Confirmada'].includes(cita.Estado) || cita.MinutosFaltan <= 0) {
      return res.status(400).json({ mensaje: 'Esta cita ya no se puede confirmar.' });
    }
    await pool.request().input('id', sql.Int, cita.CitaID)
      .query('UPDATE Citas SET ClienteConfirmo = 1, ClienteConfirmoEn = ISNULL(ClienteConfirmoEn, SYSDATETIME()) WHERE CitaID = @id');
    res.json({ mensaje: `¡Gracias! Avisamos a la clínica que llevarás a ${cita.PacienteNombre}.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo confirmar la cita.' });
  }
}

// POST /api/cliente/citas/:id/cancelar  -> hasta 2 h antes; avisa al personal
async function cancelarMiCita(req, res) {
  try {
    const pool = await getPool();
    const cita = await citaPropiaVigente(pool, req.params.id, req.propietario.propietarioId);
    if (!cita) return res.status(404).json({ mensaje: 'No encontramos esa cita.' });
    if (!['Programada', 'Confirmada'].includes(cita.Estado) || cita.MinutosFaltan <= 0) {
      return res.status(400).json({ mensaje: 'Esta cita ya no se puede cancelar.' });
    }
    if (cita.MinutosFaltan < HORAS_MIN_CANCELAR * 60) {
      return res.status(400).json({ mensaje: `Falta menos de ${HORAS_MIN_CANCELAR} horas para tu cita: para cancelarla llama a la clínica, por favor.` });
    }
    const upd = await pool.request().input('id', sql.Int, cita.CitaID)
      .query("UPDATE Citas SET Estado = 'Cancelada', CanceladaPorCliente = 1 WHERE CitaID = @id AND Estado IN ('Programada', 'Confirmada')");
    if (!upd.rowsAffected[0]) return res.status(400).json({ mensaje: 'Esta cita ya no se puede cancelar.' });

    // Sus recordatorios pendientes ya no se envían
    await pool.request().input('id', sql.Int, cita.CitaID).query(`
      UPDATE Recordatorios SET Estado = 'Fallido', Mensaje = CONCAT(N'[No enviado: la cita cambió] ', Mensaje)
      WHERE CitaID = @id AND Estado = 'Pendiente'
    `);
    await avisarAlPersonal(pool, cita, req.propietario,
      `${req.propietario.nombreCompleto} CANCELÓ desde el portal la cita de ${cita.PacienteNombre} del ${textoFechaCita(cita.FechaHora)}. El horario quedó libre.`);
    res.json({ mensaje: 'Tu cita fue cancelada. Si quieres, agenda una nueva cuando te acomode.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cancelar la cita.' });
  }
}

// GET /api/cliente/consultas/:id/receta  (solo de sus propias mascotas)
async function recetaCliente(req, res) {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ mensaje: 'Consulta inválida.' });
    const { datosReceta } = require('./consultas.controller');
    const datos = await datosReceta(await getPool(), Number(req.params.id), req.propietario.propietarioId);
    if (!datos) return res.status(404).json({ mensaje: 'Receta no encontrada.' });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar la receta.' });
  }
}

// ------------------------------------------------------------------
// Encuesta de satisfacción (una por cita ATENDIDA, solo del propio cliente)
// ------------------------------------------------------------------
// POST /api/cliente/citas/:id/encuesta  { puntuacion: 1..5, comentario? }
async function responderEncuesta(req, res) {
  const puntuacion = Number(req.body.puntuacion);
  const comentario = String(req.body.comentario || '').trim().slice(0, 500) || null;
  if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) return res.status(400).json({ mensaje: 'Elige de 1 a 5 estrellas.' });
  try {
    const pool = await getPool();
    const c = await pool.request().input('id', sql.Int, req.params.id).input('p', sql.Int, req.propietario.propietarioId)
      .query("SELECT CitaID FROM Citas WHERE CitaID = @id AND PropietarioID = @p AND Estado = 'Completada'");
    if (!c.recordset.length) return res.status(404).json({ mensaje: 'Solo puedes calificar citas ya atendidas.' });
    await pool.request().input('id', sql.Int, req.params.id).input('p', sql.Int, req.propietario.propietarioId)
      .input('pt', sql.TinyInt, puntuacion).input('c', sql.NVarChar, comentario)
      .query('INSERT INTO Encuestas (CitaID, PropietarioID, Puntuacion, Comentario) VALUES (@id, @p, @pt, @c)');
    res.status(201).json({ mensaje: '¡Gracias por tu opinión! Nos ayuda a atender mejor a tu mascota. 💚' });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) return res.status(409).json({ mensaje: 'Ya calificaste esta cita. ¡Gracias!' });
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo guardar tu opinión.' });
  }
}

// GET /api/encuestas/resumen?desde&hasta  (Administrativo, para Reportes)
async function resumenEncuestas(req, res) {
  const f = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  try {
    const pool = await getPool();
    const req2 = () => pool.request().input('d', sql.Date, f(req.query.desde)).input('h', sql.Date, f(req.query.hasta));
    const filtro = '(@d IS NULL OR CAST(e.Fecha AS DATE) >= @d) AND (@h IS NULL OR CAST(e.Fecha AS DATE) <= @h)';
    const tot = (await req2().query(`SELECT COUNT(*) AS Cantidad, AVG(CAST(e.Puntuacion AS DECIMAL(4,2))) AS Promedio FROM Encuestas e WHERE ${filtro}`)).recordset[0];
    const dist = (await req2().query(`SELECT e.Puntuacion, COUNT(*) AS N FROM Encuestas e WHERE ${filtro} GROUP BY e.Puntuacion`)).recordset;
    const comentarios = (await req2().query(`
      SELECT TOP 8 e.Puntuacion, e.Comentario, e.Fecha, p.Nombre AS PacienteNombre, pr.Nombres AS Propietario
      FROM Encuestas e INNER JOIN Citas c ON c.CitaID = e.CitaID INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      INNER JOIN Propietarios pr ON pr.PropietarioID = e.PropietarioID
      WHERE e.Comentario IS NOT NULL AND ${filtro} ORDER BY e.Fecha DESC`)).recordset;
    const distribucion = [5, 4, 3, 2, 1].map((n) => ({ estrellas: n, cantidad: (dist.find((x) => x.Puntuacion === n) || {}).N || 0 }));
    res.json({ cantidad: tot.Cantidad || 0, promedio: tot.Promedio ? Number(tot.Promedio) : null, distribucion, comentarios });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar el resumen de encuestas.' });
  }
}

module.exports = { misMascotas, registrarMascota, fotoMascota, detalleMascota, historialMascota, esquemasMascota, misCitas, solicitarCita, confirmarMiCita, cancelarMiCita, recetaCliente, responderEncuesta, resumenEncuestas };