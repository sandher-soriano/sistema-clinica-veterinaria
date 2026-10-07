// controllers/recordatorios.controller.js
const { sql, getPool } = require('../config/db');
const {
  generarRecordatorios, enviarPorCorreo, alcanceAvisos, crearAvisos, enviarAhora, marcarAvisadoManual,
} = require('../utils/recordatorios-auto');

const DESTINATARIOS = ['uno', 'todos', 'perros', 'gatos'];
const CANALES = ['App', 'Correo', 'Ambos'];

// Valida a quién va el aviso. Los avisos masivos (todos / perros / gatos) solo
// los puede mandar el Administrativo; a un cliente puntual, cualquier miembro del staff.
function validarDestinatarios(req, { destinatarios, propietarioId }) {
  if (!DESTINATARIOS.includes(destinatarios)) return 'Elige a quién enviar el aviso.';
  if (destinatarios === 'uno' && !Number.isInteger(Number(propietarioId))) return 'Elige el cliente.';
  if (destinatarios !== 'uno' && !req.usuario.accesoConfig) {
    return 'Solo el Administrativo puede enviar avisos a varios clientes a la vez.';
  }
  return null;
}

// GET /api/recordatorios/avisos/alcance?destinatarios=todos&propietarioId=
async function alcance(req, res) {
  const error = validarDestinatarios(req, req.query);
  if (error) return res.status(400).json({ mensaje: error });
  try {
    const pool = await getPool();
    res.json(await alcanceAvisos(pool, { destinatarios: req.query.destinatarios, propietarioId: Number(req.query.propietarioId) || null }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo calcular a quién le llega.' });
  }
}

// POST /api/recordatorios/avisos
// { destinatarios, propietarioId?, titulo, mensaje, enviarPor, enviarEn? ('YYYY-MM-DDTHH:mm', hora de Perú) }
async function crearAviso(req, res) {
  const { destinatarios, propietarioId } = req.body;
  const titulo = String(req.body.titulo || '').trim();
  const mensaje = String(req.body.mensaje || '').trim();
  const enviarPor = req.body.enviarPor || 'Ambos';
  const enviarEn = req.body.enviarEn ? String(req.body.enviarEn).slice(0, 16) : null;

  const error = validarDestinatarios(req, { destinatarios, propietarioId })
    || (!titulo && 'Escribe un título.')
    || (titulo.length > 120 && 'El título no puede pasar de 120 caracteres.')
    || (!mensaje && 'Escribe el mensaje.')
    || (mensaje.length > 300 && 'El mensaje no puede pasar de 300 caracteres.')
    || (!CANALES.includes(enviarPor) && 'Elige por dónde enviarlo.');
  if (error) return res.status(400).json({ mensaje: error });

  if (enviarEn) {
    const cuando = Date.parse(`${enviarEn}:00Z`); // hora literal de Perú en campos UTC
    const ahoraLima = Date.now() - 5 * 3600 * 1000;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(enviarEn) || Number.isNaN(cuando)) {
      return res.status(400).json({ mensaje: 'La fecha y hora de envío no son válidas.' });
    }
    if (cuando <= ahoraLima) return res.status(400).json({ mensaje: 'La fecha de envío ya pasó. Elige una futura, o "Enviar ahora".' });
    if (cuando - ahoraLima > 90 * 86400000) return res.status(400).json({ mensaje: 'Solo se puede programar hasta 90 días adelante.' });
  }

  try {
    const pool = await getPool();
    const quienes = await alcanceAvisos(pool, { destinatarios, propietarioId: Number(propietarioId) || null });
    if (!quienes.total) return res.status(400).json({ mensaje: 'No hay clientes activos que cumplan ese filtro.' });

    const { creados } = await crearAvisos(pool, {
      destinatarios, propietarioId: Number(propietarioId) || null, titulo, mensaje, enviarPor, enviarEn,
    });
    res.status(201).json({
      mensaje: enviarEn
        ? `Aviso programado para ${creados} cliente(s).`
        : `Aviso enviado a ${creados} cliente(s). Los correos se están enviando y a la app le llega en su próxima revisión.`,
      creados,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo crear el aviso.' });
  }
}

// POST /api/recordatorios/:id/enviar-ahora
async function enviarAhoraRecordatorio(req, res) {
  try {
    const pool = await getPool();
    const r = await enviarAhora(pool, Number(req.params.id));
    if (!r) return res.status(400).json({ mensaje: 'Solo se pueden enviar recordatorios pendientes para clientes.' });
    const partes = [];
    if (r.porCorreo) partes.push('por correo');
    if (r.porApp) partes.push('a su app (le llega en su próxima revisión o al abrirla)');
    res.json({
      mensaje: partes.length ? `Enviado ${partes.join(' y ')}.` : 'No se pudo enviar: el cliente no tiene correo y este aviso era solo por correo.',
      ...r,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo enviar.' });
  }
}

// GET /api/recordatorios?estado=Pendiente&buscar=texto
async function listar(req, res) {
  try {
    const estado = req.query.estado || 'Todos';
    const buscar = req.query.buscar || '';

    const pool = await getPool();
    const result = await pool
      .request()
      .input('buscar', sql.NVarChar, `%${buscar}%`)
      .input('estado', sql.NVarChar, estado)
      .query(`
        SELECT r.RecordatorioID, r.TipoRecordatorio, r.FechaProgramada, r.Canal, r.Estado,
               r.Mensaje, r.EnviadoEn, r.CreadoEn, r.Destino, r.CanalEnvio,
               r.Titulo, r.EnviarPor, r.EnviarDesde,
               p.PacienteID, p.Nombre AS PacienteNombre, p.Especie, p.Raza, p.FotoURL,
               pr.PropietarioID, pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos,
               pr.Telefono AS PropietarioTelefono,
               -- Para la columna de seguimiento automático:
               CASE WHEN pr.CorreoElectronico IS NOT NULL THEN 1 ELSE 0 END AS ConCorreo,
               CASE WHEN pr.ContrasenaHash IS NOT NULL THEN 1 ELSE 0 END AS ConApp,
               -- cuándo lo envía solo el sistema (mismas reglas que utils/recordatorios-auto.js)
               CASE
                 WHEN r.EnviarDesde IS NOT NULL THEN r.EnviarDesde
                 WHEN r.TipoRecordatorio IN ('Vacuna', 'Desparasitacion')
                   THEN DATEADD(DAY, -ISNULL(g.DiasAntes, 7), CAST(CAST(r.FechaProgramada AS DATE) AS DATETIME2))
                 WHEN r.TipoRecordatorio = 'Cita' AND r.CitaID IS NOT NULL THEN r.CreadoEn
                 WHEN r.TipoRecordatorio = 'Cita' THEN DATEADD(HOUR, -24, r.FechaProgramada)
                 ELSE r.FechaProgramada
               END AS EnvioPrevisto,
               -- ya pasó la fecha del evento sin que se enviara (el cliente ya no lo recibirá)
               CASE WHEN r.Estado = 'Pendiente' AND r.FechaProgramada < DATEADD(DAY, -1, CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE))
                         AND r.EnviarDesde IS NULL
                    THEN 1 ELSE 0 END AS Vencido,
               DATEADD(HOUR, -5, SYSUTCDATETIME()) AS AhoraLima
        FROM Recordatorios r
        LEFT JOIN Pacientes p ON p.PacienteID = r.PacienteID  -- los avisos generales no son de una mascota
        INNER JOIN Propietarios pr ON pr.PropietarioID = r.PropietarioID
        LEFT JOIN ReglasRecordatorioAutomatico g ON g.TipoRecordatorio = r.TipoRecordatorio
        WHERE (@estado = 'Todos' OR r.Estado = @estado)
          AND (@buscar = '%%' OR p.Nombre LIKE @buscar OR pr.Nombres LIKE @buscar OR pr.Apellidos LIKE @buscar
               OR r.Titulo LIKE @buscar)
        ORDER BY
          CASE r.Estado WHEN 'Pendiente' THEN 1 WHEN 'Fallido' THEN 2 ELSE 3 END,
          r.FechaProgramada ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar los recordatorios.' });
  }
}

// GET /api/recordatorios/resumen -> conteos para las tarjetas rápidas
async function resumen(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        COUNT(*) AS Total,
        SUM(CASE WHEN Estado = 'Enviado' THEN 1 ELSE 0 END) AS Enviados,
        SUM(CASE WHEN Estado = 'Pendiente' THEN 1 ELSE 0 END) AS Pendientes,
        SUM(CASE WHEN Estado = 'Fallido' THEN 1 ELSE 0 END) AS Fallidos
      FROM Recordatorios
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al calcular el resumen.' });
  }
}

// POST /api/recordatorios  (recordatorio manual)
// Body: { pacienteId, tipoRecordatorio, fechaProgramada, canal, mensaje }
async function crear(req, res) {
  try {
    const { pacienteId, tipoRecordatorio, fechaProgramada, canal, mensaje } = req.body;

    if (!pacienteId || !tipoRecordatorio || !fechaProgramada) {
      return res.status(400).json({ mensaje: 'Paciente, tipo y fecha programada son obligatorios.' });
    }

    const pool = await getPool();

    const pacienteResult = await pool
      .request()
      .input('pacienteId', sql.Int, pacienteId)
      .query('SELECT PropietarioID, Nombre FROM Pacientes WHERE PacienteID = @pacienteId');

    if (pacienteResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Paciente no encontrado.' });
    }
    const propietarioId = pacienteResult.recordset[0].PropietarioID;

    await pool
      .request()
      .input('pacienteId', sql.Int, pacienteId)
      .input('propietarioId', sql.Int, propietarioId)
      .input('tipoRecordatorio', sql.NVarChar, tipoRecordatorio)
      .input('fechaProgramada', sql.DateTime2, fechaProgramada)
      .input('canal', sql.NVarChar, canal || 'Push')
      .input('mensaje', sql.NVarChar, mensaje || null)
      .query(`
        INSERT INTO Recordatorios (PacienteID, PropietarioID, TipoRecordatorio, FechaProgramada, Canal, Estado, Mensaje)
        VALUES (@pacienteId, @propietarioId, @tipoRecordatorio, @fechaProgramada, @canal, 'Pendiente', @mensaje)
      `);

    res.status(201).json({ mensaje: 'Recordatorio creado correctamente.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al crear el recordatorio.' });
  }
}

// PATCH /api/recordatorios/:id/estado
// Body: { estado: 'Enviado' | 'Fallido' | 'Pendiente' }
async function cambiarEstado(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['Enviado', 'Fallido', 'Pendiente'].includes(estado)) {
      return res.status(400).json({ mensaje: 'Estado inválido.' });
    }

    const pool = await getPool();
    const existe = await pool.request().input('id', sql.Int, id)
      .query('SELECT 1 FROM Recordatorios WHERE RecordatorioID = @id');
    if (!existe.recordset.length) {
      return res.status(404).json({ mensaje: 'Recordatorio no encontrado.' });
    }

    // "Enviado" puesto a mano = "Ya avisé por teléfono": queda registrado como
    // aviso manual y el envío automático ya NO lo vuelve a mandar.
    if (estado === 'Enviado') {
      await marcarAvisadoManual(pool, Number(id));
      return res.json({ mensaje: 'Marcado como avisado a mano. El sistema ya no lo enviará.' });
    }

    await pool
      .request()
      .input('id', sql.Int, id)
      .input('estado', sql.NVarChar, estado)
      .query('UPDATE Recordatorios SET Estado = @estado, EnviadoEn = NULL WHERE RecordatorioID = @id');
    res.json({ mensaje: estado === 'Fallido' ? 'Recordatorio descartado: no se enviará.' : 'Estado actualizado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al actualizar el estado.' });
  }
}

// GET /api/recordatorios/reglas
async function listarReglas(req, res) {
  try {
    const pool = await getPool();
    let result = await pool.request().query('SELECT * FROM ReglasRecordatorioAutomatico');

    // Si todavía no hay reglas guardadas, se crean las 2 reglas por defecto
    // (una por cada tipo de esquema preventivo que sí generamos automáticamente).
    if (result.recordset.length === 0) {
      await pool.request().query(`
        INSERT INTO ReglasRecordatorioAutomatico (TipoRecordatorio, DiasAntes, Activo) VALUES
          ('Vacuna', 3, 1),
          ('Desparasitacion', 3, 1)
      `);
      result = await pool.request().query('SELECT * FROM ReglasRecordatorioAutomatico');
    }

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar las reglas.' });
  }
}

// PUT /api/recordatorios/reglas/:id
// Body: { diasAntes, activo }
async function actualizarRegla(req, res) {
  try {
    const { id } = req.params;
    const { diasAntes, activo } = req.body;

    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('diasAntes', sql.Int, diasAntes)
      .input('activo', sql.Bit, activo)
      .query('UPDATE ReglasRecordatorioAutomatico SET DiasAntes = @diasAntes, Activo = @activo WHERE ReglaID = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ mensaje: 'Regla no encontrada.' });
    }
    res.json({ mensaje: 'Regla actualizada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al actualizar la regla.' });
  }
}

// POST /api/recordatorios/generar-automaticos
// Lo mismo que hace solo el servidor cada 15 minutos (utils/recordatorios-auto.js),
// pero a pedido: al abrir la pantalla de Recordatorios o con "Volver a revisar ahora".
async function generarAutomaticos(req, res) {
  try {
    const pool = await getPool();
    const creados = await generarRecordatorios(pool);
    const enviados = await enviarPorCorreo(pool);
    res.json({ mensaje: `Se generaron ${creados} recordatorio(s) nuevo(s)${enviados ? ` y se enviaron ${enviados} por correo` : ''}.`, creados, enviados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al generar los recordatorios automáticos.' });
  }
}

module.exports = { listar, resumen, crear, cambiarEstado, listarReglas, actualizarRegla, generarAutomaticos, alcance, crearAviso, enviarAhoraRecordatorio };
