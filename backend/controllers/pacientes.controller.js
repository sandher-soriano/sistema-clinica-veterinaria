// controllers/pacientes.controller.js
const { sql, getPool } = require('../config/db');
const esDuplicado = (err) => err && (err.number === 2627 || err.number === 2601);
const { registrarAuditoria } = require('../utils/auditoria');
const { verificarDominioCorreo } = require('../utils/emailValidator');

function esFechaFutura(fechaIso) {
  if (!fechaIso) return false;
  const hoy = new Date().toISOString().substring(0, 10);
  return fechaIso > hoy;
}

// GET /api/pacientes
// Devuelve cada paciente con su propietario, edad calculada, última visita
// (si tiene consultas) y el estado más urgente de su esquema preventivo.
// Incluye activos E inactivos: el frontend filtra por Estado si quiere.
async function listar(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        p.PacienteID, p.Nombre, p.Especie, p.Raza, p.FechaNacimiento, p.Sexo,
        p.FotoURL, p.Alergias, p.Activo, p.RegistradoPorCliente,
        pr.PropietarioID, pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos,
        pr.Telefono AS PropietarioTelefono,
        (SELECT MAX(FechaConsulta) FROM Consultas c WHERE c.PacienteID = p.PacienteID) AS UltimaVisita,
        -- Resumen para la lista (con la fecha de HOY en Perú, mirando solo las
        -- dosis por aplicar): Atrasado si alguna ya venció; Pendiente si alguna
        -- vence en ≤30 días; AlDia si tiene esquemas y nada urgente.
        (
          SELECT CASE
            WHEN COUNT(*) = 0 THEN NULL
            WHEN SUM(CASE WHEN e.FechaAplicacion IS NULL AND e.FechaProximaDosis < CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE) THEN 1 ELSE 0 END) > 0 THEN 'Atrasado'
            WHEN SUM(CASE WHEN e.FechaAplicacion IS NULL AND e.FechaProximaDosis <= DATEADD(DAY, 30, CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE)) THEN 1 ELSE 0 END) > 0 THEN 'Pendiente'
            ELSE 'AlDia' END
          FROM EsquemasPreventivos e
          WHERE e.PacienteID = p.PacienteID
        ) AS EstadoVacunacion
      FROM Pacientes p
      INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
      ORDER BY p.FechaRegistro DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar pacientes.' });
  }
}

// POST /api/pacientes
// Body:
// {
//   propietarioId?: number,                 // si el dueño ya existe
//   propietarioNuevo?: {                    // si hay que crear un dueño nuevo
//     nombres, apellidos, telefono, correo, direccion,
//     numeroDocumento, dniValidado           // DNI + si ya se validó contra RENIEC
//   },
//   nombre, especie, raza, fechaNacimiento, sexo, alergias
// }
async function crear(req, res) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    const { propietarioId, propietarioNuevo, nombre, especie, raza, fechaNacimiento, sexo, alergias } = req.body;

    if (!nombre || !especie) {
      return res.status(400).json({ mensaje: 'El nombre y la especie de la mascota son obligatorios.' });
    }
    if (!propietarioId && !propietarioNuevo) {
      return res.status(400).json({ mensaje: 'Debes seleccionar un propietario existente o registrar uno nuevo.' });
    }
    if (propietarioNuevo && (!propietarioNuevo.nombres || !propietarioNuevo.apellidos)) {
      return res.status(400).json({ mensaje: 'Nombres y apellidos del propietario son obligatorios.' });
    }
    // El DNI es opcional, pero si se escribe algo, tiene que ser exactamente
    // 8 dígitos — no se permite 6, 7 ni más de 8.
    if (propietarioNuevo && propietarioNuevo.numeroDocumento && !/^\d{8}$/.test(propietarioNuevo.numeroDocumento)) {
      return res.status(400).json({ mensaje: 'El DNI del propietario debe tener exactamente 8 dígitos.' });
    }
    // Validación: la mascota no puede haber "nacido en el futuro".
    if (esFechaFutura(fechaNacimiento)) {
      return res.status(400).json({ mensaje: 'La fecha de nacimiento no puede ser una fecha futura.' });
    }
    // Si el propietario nuevo trae correo, verificamos que el dominio
    // tenga un servidor de correo real antes de crear nada.
    if (propietarioNuevo && propietarioNuevo.correo) {
      const validacionCorreo = await verificarDominioCorreo(propietarioNuevo.correo);
      if (validacionCorreo.valido === false) {
        return res.status(400).json({ mensaje: validacionCorreo.mensaje });
      }
    }

    await transaction.begin();

    let propietarioIdFinal = propietarioId;

    if (!propietarioIdFinal) {
      const insertPropietario = await new sql.Request(transaction)
        .input('nombres', sql.NVarChar, propietarioNuevo.nombres)
        .input('apellidos', sql.NVarChar, propietarioNuevo.apellidos)
        .input('telefono', sql.NVarChar, propietarioNuevo.telefono || null)
        .input('correo', sql.NVarChar, propietarioNuevo.correo || null)
        .input('direccion', sql.NVarChar, propietarioNuevo.direccion || null)
        .input('codigoDistrito', sql.Char(6), propietarioNuevo.codigoDistrito || null)
        .input('numeroDocumento', sql.NVarChar, propietarioNuevo.numeroDocumento || null)
        .input('dniValidado', sql.Bit, !!propietarioNuevo.dniValidado)
        .query(`
          INSERT INTO Propietarios (Nombres, Apellidos, Telefono, CorreoElectronico, Direccion, CodigoDistrito, NumeroDocumento, DniValidado)
          OUTPUT INSERTED.PropietarioID
          VALUES (@nombres, @apellidos, @telefono, @correo, @direccion, @codigoDistrito, @numeroDocumento, @dniValidado)
        `);
      propietarioIdFinal = insertPropietario.recordset[0].PropietarioID;
    }

    const insertPaciente = await new sql.Request(transaction)
      .input('propietarioId', sql.Int, propietarioIdFinal)
      .input('nombre', sql.NVarChar, nombre)
      .input('especie', sql.NVarChar, especie)
      .input('raza', sql.NVarChar, raza || null)
      .input('fechaNacimiento', sql.Date, fechaNacimiento || null)
      .input('sexo', sql.Char, sexo || null)
      .input('alergias', sql.NVarChar, alergias || null)
      .query(`
        INSERT INTO Pacientes (PropietarioID, Nombre, Especie, Raza, FechaNacimiento, Sexo, Alergias)
        OUTPUT INSERTED.PacienteID
        VALUES (@propietarioId, @nombre, @especie, @raza, @fechaNacimiento, @sexo, @alergias)
      `);

    await transaction.commit();

    const pacienteId = insertPaciente.recordset[0].PacienteID;

    await registrarAuditoria(pool, {
      tabla: 'Pacientes',
      registroId: pacienteId,
      accion: 'Crear',
      usuarioId: req.usuario.usuarioId,
      detalle: `Registró al paciente "${nombre}".`,
    });

    res.status(201).json({
      mensaje: 'Paciente registrado correctamente.',
      pacienteId,
      propietarioId: propietarioIdFinal,
    });
  } catch (err) {
    console.error(err);
    try { await transaction.rollback(); } catch (_) { /* ya estaba cerrada */ }

    if (esDuplicado(err)) { // UNIQUE: 2627 = restricción, 2601 = índice único filtrado
      return res.status(409).json({ mensaje: 'Ese correo o número de documento de propietario ya está registrado.' });
    }
    res.status(500).json({ mensaje: 'Error al registrar el paciente.' });
  }
}

// GET /api/pacientes/:id
// Detalle de un paciente + su propietario. Usado por Historia Clínica,
// Esquemas Preventivos y el modal de edición en Pacientes.
async function obtener(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT
          p.PacienteID, p.Nombre, p.Especie, p.Raza, p.FechaNacimiento, p.Sexo,
          p.FotoURL, p.Alergias, p.Activo, p.PropietarioID, p.RegistradoPorCliente,
          pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos,
          pr.Telefono AS PropietarioTelefono, pr.CorreoElectronico AS PropietarioCorreo
        FROM Pacientes p
        INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
        WHERE p.PacienteID = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Paciente no encontrado.' });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener el paciente.' });
  }
}

// PUT /api/pacientes/:id
// Solo edita los datos de la MASCOTA (no cambia de propietario aquí).
// Body: { nombre, especie, raza, fechaNacimiento, sexo, alergias }
async function actualizar(req, res) {
  try {
    const { id } = req.params;
    const { nombre, especie, raza, fechaNacimiento, sexo, alergias } = req.body;

    if (!nombre || !especie) {
      return res.status(400).json({ mensaje: 'El nombre y la especie son obligatorios.' });
    }
    if (esFechaFutura(fechaNacimiento)) {
      return res.status(400).json({ mensaje: 'La fecha de nacimiento no puede ser una fecha futura.' });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('nombre', sql.NVarChar, nombre)
      .input('especie', sql.NVarChar, especie)
      .input('raza', sql.NVarChar, raza || null)
      .input('fechaNacimiento', sql.Date, fechaNacimiento || null)
      .input('sexo', sql.Char, sexo || null)
      .input('alergias', sql.NVarChar, alergias || null)
      .query(`
        UPDATE Pacientes
        SET Nombre = @nombre, Especie = @especie, Raza = @raza,
            FechaNacimiento = @fechaNacimiento, Sexo = @sexo, Alergias = @alergias,
            RegistradoPorCliente = 0   -- el personal revisó los datos que cargó el cliente
        WHERE PacienteID = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ mensaje: 'Paciente no encontrado.' });
    }

    await registrarAuditoria(pool, {
      tabla: 'Pacientes',
      registroId: Number(id),
      accion: 'Actualizar',
      usuarioId: req.usuario.usuarioId,
      detalle: `Editó los datos del paciente "${nombre}".`,
    });

    res.json({ mensaje: 'Paciente actualizado correctamente.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al actualizar el paciente.' });
  }
}

// PATCH /api/pacientes/:id/estado   Body: { activo: true|false }
// Activar/desactivar — nunca se elimina un paciente (igual que Usuarios y
// Personas), por ejemplo si la mascota falleció o el dueño ya no es cliente.
async function cambiarEstado(req, res) {
  try {
    const { id } = req.params;
    const { activo } = req.body;
    const pool = await getPool();

    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('activo', sql.Bit, activo)
      .query('UPDATE Pacientes SET Activo = @activo WHERE PacienteID = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ mensaje: 'Paciente no encontrado.' });
    }

    await registrarAuditoria(pool, {
      tabla: 'Pacientes',
      registroId: Number(id),
      accion: activo ? 'Activar' : 'Desactivar',
      usuarioId: req.usuario.usuarioId,
      detalle: activo ? 'Reactivó al paciente.' : 'Desactivó al paciente.',
    });

    res.json({ mensaje: 'Estado actualizado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al actualizar el estado.' });
  }
}

// GET /api/pacientes/:id/auditoria
// Historial de quién registró/editó/activó/desactivó a este paciente.
async function obtenerAuditoria(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query(`
        SELECT a.AuditoriaID, a.Accion, a.Detalle, a.FechaHora,
               (per.Nombres + ' ' + per.Apellidos) AS UsuarioNombre
        FROM Auditoria a
        INNER JOIN Usuarios u ON u.UsuarioID = a.UsuarioID
        INNER JOIN Personas per ON per.PersonaID = u.PersonaID
        WHERE a.TablaAfectada = 'Pacientes' AND a.RegistroID = @id
        ORDER BY a.FechaHora DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener el historial de auditoría.' });
  }
}

// POST /api/pacientes/:id/foto  (multipart/form-data, campo "foto")
// Guarda la imagen en disco y actualiza Pacientes.FotoURL.
// El archivo ya viene guardado en disco por multer (ver routes/pacientes.routes.js);
// aquí solo actualizamos la referencia en la base de datos.
async function subirFoto(req, res) {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ mensaje: 'No se recibió ninguna imagen.' });
    }

    const fotoUrl = `/uploads/pacientes/${req.file.filename}`;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('fotoUrl', sql.NVarChar, fotoUrl)
      .query('UPDATE Pacientes SET FotoURL = @fotoUrl WHERE PacienteID = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ mensaje: 'Paciente no encontrado.' });
    }

    res.json({ mensaje: 'Foto actualizada.', fotoUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al subir la foto.' });
  }
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado, obtenerAuditoria, subirFoto };