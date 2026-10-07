// controllers/esquemas.controller.js
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { actualizarEstadosEsquemas } = require('../utils/estadoEsquemas');

// Cuánto dura la protección de cada tipo de esquema. Se usa para calcular
// SOLO Y AUTOMÁTICAMENTE la fecha de la próxima dosis — el usuario nunca
// la escribe a mano.
const INTERVALOS_DIAS = {
  'Vacuna': 365,           // refuerzo anual (ej. antirrábica)
  'Desparasitación': 180,  // cada ~6 meses
};

// "Hoy" en Perú (UTC-5). Con la fecha UTC, después de las 19:00 "aplicar hoy"
// guardaba la fecha de mañana.
function hoyISO() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().substring(0, 10);
}

// El recordatorio pendiente de ESA dosis (misma mascota, tipo y fecha
// programada) ya no sirve cuando la dosis se aplica o se reemplaza: no se envía.
// Solo esa fecha: las otras vacunas de la mascota conservan su recordatorio.
const TIPO_RECORDATORIO = { 'Vacuna': 'Vacuna', 'Desparasitación': 'Desparasitacion' };
async function anularRecordatoriosPendientes(pool, pacienteId, nombreTipo, fechaDosis) {
  const tipo = TIPO_RECORDATORIO[nombreTipo];
  if (!tipo || !fechaDosis) return;
  await pool.request()
    .input('pacienteId', sql.Int, pacienteId)
    .input('tipo', sql.NVarChar, tipo)
    .input('fecha', sql.Date, fechaDosis)
    .query(`
      UPDATE Recordatorios SET Estado = 'Fallido', Mensaje = CONCAT(N'[No enviado: la dosis ya se aplicó] ', Mensaje)
      WHERE PacienteID = @pacienteId AND TipoRecordatorio = @tipo AND Estado = 'Pendiente'
        AND CAST(FechaProgramada AS DATE) = @fecha
    `);
}

function sumarDias(fechaIso, dias) {
  const f = new Date(fechaIso);
  f.setDate(f.getDate() + dias);
  return f.toISOString().substring(0, 10);
}

// Estado según la situación real del registro:
// - Todavía no se aplicó (FechaAplicacion NULL, es la dosis "pendiente"
//   que el sistema generó sola): se compara la fecha objetivo
//   (FechaProximaDosis) contra hoy -> Atrasado si ya pasó, si no, Pendiente.
// - Ya se aplicó: se compara la fecha de la PRÓXIMA dosis (el refuerzo
//   que corresponde después) -> Atrasado / Pendiente (≤30 días) / AlDia.
function calcularEstado(fechaProximaDosis, fechaAplicacion) {
  // Normaliza a 'YYYY-MM-DD' (de la base llegan objetos Date; comparar Date con texto siempre da falso)
  const aIso = (f) => (f instanceof Date ? f.toISOString().substring(0, 10) : f);
  fechaProximaDosis = aIso(fechaProximaDosis);
  fechaAplicacion = aIso(fechaAplicacion);
  if (!fechaAplicacion) {
    if (!fechaProximaDosis) return 'Pendiente';
    return fechaProximaDosis < hoyISO() ? 'Atrasado' : 'Pendiente';
  }
  if (!fechaProximaDosis) return 'AlDia';
  const diffDias = Math.round((new Date(fechaProximaDosis) - new Date(hoyISO())) / (1000 * 60 * 60 * 24));
  if (diffDias < 0) return 'Atrasado';
  if (diffDias <= 30) return 'Pendiente';
  return 'AlDia';
}

async function obtenerNombreTipo(pool, tipoEsquemaId) {
  const result = await pool
    .request()
    .input('tipoEsquemaId', sql.Int, tipoEsquemaId)
    .query('SELECT NombreTipo FROM TiposEsquemaPreventivo WHERE TipoEsquemaID = @tipoEsquemaId');
  return result.recordset[0] ? result.recordset[0].NombreTipo : null;
}

// Inserta el registro "pendiente" de la SIGUIENTE dosis (encadenado
// automáticamente, sin que nadie lo pida a mano).
async function crearPendienteAutomatico(pool, { pacienteId, tipoEsquemaId, nombreProducto, fechaProximaDosis, fechaBase }) {
  const estado = calcularEstado(fechaProximaDosis, null);
  await pool
    .request()
    .input('pacienteId', sql.Int, pacienteId)
    .input('tipoEsquemaId', sql.Int, tipoEsquemaId)
    .input('nombreProducto', sql.NVarChar, nombreProducto)
    .input('fechaProximaDosis', sql.Date, fechaProximaDosis)
    .input('estado', sql.NVarChar, estado)
    .input('observaciones', sql.NVarChar, `Próxima dosis programada automáticamente al aplicar la del ${fechaBase}.`)
    .query(`
      INSERT INTO EsquemasPreventivos (PacienteID, TipoEsquemaID, NombreProducto, FechaAplicacion, FechaProximaDosis, Estado, Observaciones)
      VALUES (@pacienteId, @tipoEsquemaId, @nombreProducto, NULL, @fechaProximaDosis, @estado, @observaciones)
    `);
}

// GET /api/esquemas?pacienteId=X
async function listarPorPaciente(req, res) {
  try {
    const { pacienteId } = req.query;
    if (!pacienteId) {
      return res.status(400).json({ mensaje: 'Falta el parámetro pacienteId.' });
    }

    const pool = await getPool();
    // Misma regla única que Dashboard y Reportes (utils/estadoEsquemas.js): sabe
    // si una dosis ya tuvo un refuerzo posterior. Antes aquí se recalculaba en JS
    // comparando un objeto Date con un texto (siempre falso: nunca "Atrasado").
    await actualizarEstadosEsquemas(pool);
    const result = await pool
      .request()
      .input('pacienteId', sql.Int, pacienteId)
      .query(`
        SELECT e.EsquemaID, e.NombreProducto, e.FechaAplicacion, e.FechaProximaDosis, e.Estado,
               e.Observaciones, t.TipoEsquemaID, t.NombreTipo AS TipoEsquema,
               (per.Nombres + ' ' + per.Apellidos) AS VeterinarioNombre
        FROM EsquemasPreventivos e
        INNER JOIN TiposEsquemaPreventivo t ON t.TipoEsquemaID = e.TipoEsquemaID
        LEFT JOIN Usuarios u ON u.UsuarioID = e.VeterinarioID
        LEFT JOIN Personas per ON per.PersonaID = u.PersonaID
        WHERE e.PacienteID = @pacienteId
        ORDER BY COALESCE(e.FechaAplicacion, e.FechaProximaDosis) DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar los esquemas preventivos.' });
  }
}

// GET /api/esquemas/tipos
async function listarTipos(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      'SELECT TipoEsquemaID, NombreTipo FROM TiposEsquemaPreventivo ORDER BY NombreTipo'
    );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar los tipos de esquema.' });
  }
}

// POST /api/esquemas
// SIEMPRE registra una dosis YA APLICADA (no hay modo "pendiente" manual).
// Body: { pacienteId, tipoEsquemaId, nombreProducto, fechaAplicacion, observaciones }
//
// Automáticamente, además:
// 1) Calcula la fecha de la próxima dosis según el tipo (Vacuna: +1 año,
//    Desparasitación: +6 meses).
// 2) Crea SOLO un segundo registro para esa próxima dosis, en estado
//    "Pendiente", listo para que aparezca en el historial con el botón
//    "Aplicar ahora".
async function crear(req, res) {
  try {
    const { pacienteId, tipoEsquemaId, nombreProducto, fechaAplicacion, observaciones } = req.body;

    if (!pacienteId || !tipoEsquemaId || !nombreProducto || !fechaAplicacion) {
      return res.status(400).json({
        mensaje: 'Paciente, tipo, nombre del producto y fecha de aplicación son obligatorios.',
      });
    }

    const pool = await getPool();
    const nombreTipo = await obtenerNombreTipo(pool, tipoEsquemaId);
    if (!nombreTipo) {
      return res.status(400).json({ mensaje: 'Tipo de esquema inválido.' });
    }

    const intervalo = INTERVALOS_DIAS[nombreTipo] || 365;
    const fechaProximaDosis = sumarDias(fechaAplicacion, intervalo);
    const estado = calcularEstado(fechaProximaDosis, fechaAplicacion);

    // La dosis "pendiente" que ya existía de este mismo producto queda
    // reemplazada por la que se registra ahora (antes quedaba "Atrasada" para
    // siempre y seguía generando recordatorios).
    const reemplazadas = await pool.request()
      .input('pacienteId', sql.Int, pacienteId)
      .input('tipoEsquemaId', sql.Int, tipoEsquemaId)
      .input('nombreProducto', sql.NVarChar, nombreProducto)
      .query(`
        DELETE FROM EsquemasPreventivos
        OUTPUT DELETED.FechaProximaDosis
        WHERE PacienteID = @pacienteId AND TipoEsquemaID = @tipoEsquemaId
          AND NombreProducto = @nombreProducto AND FechaAplicacion IS NULL
      `);
    for (const d of reemplazadas.recordset) {
      await anularRecordatoriosPendientes(pool, pacienteId, nombreTipo, d.FechaProximaDosis);
    }

    const result = await pool
      .request()
      .input('pacienteId', sql.Int, pacienteId)
      .input('tipoEsquemaId', sql.Int, tipoEsquemaId)
      .input('nombreProducto', sql.NVarChar, nombreProducto)
      .input('fechaAplicacion', sql.Date, fechaAplicacion)
      .input('fechaProximaDosis', sql.Date, fechaProximaDosis)
      .input('estado', sql.NVarChar, estado)
      .input('veterinarioId', sql.Int, req.usuario.usuarioId)
      .input('observaciones', sql.NVarChar, observaciones || null)
      .query(`
        INSERT INTO EsquemasPreventivos
          (PacienteID, TipoEsquemaID, NombreProducto, FechaAplicacion, FechaProximaDosis, Estado, VeterinarioID, Observaciones)
        OUTPUT INSERTED.EsquemaID
        VALUES (@pacienteId, @tipoEsquemaId, @nombreProducto, @fechaAplicacion, @fechaProximaDosis, @estado, @veterinarioId, @observaciones)
      `);

    // Encadena automáticamente la siguiente dosis, como pendiente.
    await crearPendienteAutomatico(pool, {
      pacienteId, tipoEsquemaId, nombreProducto, fechaProximaDosis, fechaBase: fechaAplicacion,
    });

    await registrarAuditoria(pool, { tabla: 'EsquemasPreventivos', registroId: result.recordset[0].EsquemaID, accion: 'Crear', usuarioId: req.usuario.usuarioId, detalle: `Registró ${nombreTipo.toLowerCase()} ${nombreProducto} aplicada el ${fechaAplicacion} a paciente #${pacienteId}` });
    res.status(201).json({
      mensaje: 'Dosis registrada. La siguiente quedó programada automáticamente como pendiente.',
      esquemaId: result.recordset[0].EsquemaID,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al registrar la dosis.' });
  }
}

// PATCH /api/esquemas/:id/aplicar
// Marca una dosis PENDIENTE (generada automáticamente) como aplicada hoy
// (o en la fecha indicada). Y, otra vez automáticamente, encadena la
// SIGUIENTE dosis pendiente después de esta.
// Body opcional: { fechaAplicacion } (por defecto: hoy)
async function aplicar(req, res) {
  try {
    const { id } = req.params;
    const fechaAplicacion = req.body.fechaAplicacion || hoyISO();

    const pool = await getPool();

    const actual = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT e.EsquemaID, e.FechaAplicacion, e.FechaProximaDosis, e.PacienteID, e.TipoEsquemaID, e.NombreProducto, t.NombreTipo
        FROM EsquemasPreventivos e
        INNER JOIN TiposEsquemaPreventivo t ON t.TipoEsquemaID = e.TipoEsquemaID
        WHERE e.EsquemaID = @id
      `);

    if (actual.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Esquema no encontrado.' });
    }
    const registro = actual.recordset[0];
    if (registro.FechaAplicacion) {
      return res.status(400).json({ mensaje: 'Esta dosis ya fue marcada como aplicada.' });
    }

    const intervalo = INTERVALOS_DIAS[registro.NombreTipo] || 365;
    const fechaProximaDosis = sumarDias(fechaAplicacion, intervalo);
    const estado = calcularEstado(fechaProximaDosis, fechaAplicacion);

    // "AND FechaAplicacion IS NULL": si llegan dos clics a la vez, solo el
    // primero aplica la dosis; el segundo no encadena otra dosis duplicada.
    const actualizado = await pool
      .request()
      .input('id', sql.Int, id)
      .input('fechaAplicacion', sql.Date, fechaAplicacion)
      .input('fechaProximaDosis', sql.Date, fechaProximaDosis)
      .input('estado', sql.NVarChar, estado)
      .input('veterinarioId', sql.Int, req.usuario.usuarioId)
      .query(`
        UPDATE EsquemasPreventivos
        SET FechaAplicacion = @fechaAplicacion,
            FechaProximaDosis = @fechaProximaDosis,
            Estado = @estado,
            VeterinarioID = @veterinarioId
        WHERE EsquemaID = @id AND FechaAplicacion IS NULL
      `);
    if (!actualizado.rowsAffected[0]) {
      return res.status(400).json({ mensaje: 'Esta dosis ya fue marcada como aplicada.' });
    }
    // El recordatorio de la fecha ANTERIOR (la que se esperaba) ya no se envía
    await anularRecordatoriosPendientes(pool, registro.PacienteID, registro.NombreTipo, registro.FechaProximaDosis);

    // Encadena automáticamente la dosis que sigue después de esta.
    await crearPendienteAutomatico(pool, {
      pacienteId: registro.PacienteID,
      tipoEsquemaId: registro.TipoEsquemaID,
      nombreProducto: registro.NombreProducto,
      fechaProximaDosis,
      fechaBase: fechaAplicacion,
    });

    await registrarAuditoria(pool, { tabla: 'EsquemasPreventivos', registroId: Number(id), accion: 'Aplicar', usuarioId: req.usuario.usuarioId, detalle: `Aplicó ${registro.NombreProducto} a paciente #${registro.PacienteID} el ${fechaAplicacion}` });
    res.json({ mensaje: 'Dosis marcada como aplicada. Se programó automáticamente la siguiente.', fechaProximaDosis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al marcar la dosis como aplicada.' });
  }
}

module.exports = { listarPorPaciente, listarTipos, crear, aplicar };