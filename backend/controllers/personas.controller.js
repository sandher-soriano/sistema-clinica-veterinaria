// controllers/personas.controller.js
// Gestiona el "Personal" contratado (veterinarios y administrativos), como
// PERSONAS — independientemente de si ya tienen o no un Usuario del
// sistema. Esto es lo que faltaba: antes se pedían nombre/correo directo
// al crear el Usuario, ahora primero se registra a la persona aquí, y
// recién después (en Config > Usuarios) se le da acceso al sistema
// eligiéndola de esta lista.
const { sql, getPool } = require('../config/db');
const esDuplicado = (err) => err && (err.number === 2627 || err.number === 2601);
const { verificarDominioCorreo } = require('../utils/emailValidator');

// El DNI es obligatorio (8 dígitos exactos). El teléfono es opcional, pero
// si se escribe algo, tiene que tener 9 dígitos — nunca menos ni más.
function validarDniTelefono(numeroDocumento, telefono) {
  if (!numeroDocumento || !/^\d{8}$/.test(numeroDocumento)) {
    return 'El DNI debe tener exactamente 8 dígitos.';
  }
  if (telefono && !/^\d{9}$/.test(telefono)) {
    return 'El teléfono debe tener exactamente 9 dígitos.';
  }
  return null;
}

function esFechaFutura(fechaIso) {
  if (!fechaIso) return false;
  const hoy = new Date().toISOString().substring(0, 10);
  return fechaIso > hoy;
}

// GET /api/personas
// Devuelve todo el personal, indicando si ya tiene un Usuario asignado
// (TieneUsuario), y su dirección completa armada desde el Ubigeo (si
// eligió Departamento/Provincia/Distrito).
async function listar(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT p.PersonaID, p.Nombres, p.Apellidos, p.NumeroDocumento, p.Telefono,
             p.CorreoElectronico, p.Direccion, p.FechaNacimiento, p.Activo,
             p.CodigoDistrito, dist.Nombre AS Distrito, dist.CodigoProvincia, dist.CodigoDepartamento,
             prov.Nombre AS Provincia, dep.Nombre AS Departamento,
             u.UsuarioID, u.NombreUsuario,
             CASE WHEN u.UsuarioID IS NULL THEN 0 ELSE 1 END AS TieneUsuario
      FROM Personas p
      LEFT JOIN Usuarios u ON u.PersonaID = p.PersonaID
      LEFT JOIN Distritos dist ON dist.CodigoDistrito = p.CodigoDistrito
      LEFT JOIN Provincias prov ON prov.CodigoProvincia = dist.CodigoProvincia
      LEFT JOIN Departamentos dep ON dep.CodigoDepartamento = dist.CodigoDepartamento
      ORDER BY p.Nombres
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar el personal.' });
  }
}

// POST /api/personas
// Body: { nombres, apellidos, numeroDocumento, telefono?, correo,
//         direccion?, codigoDistrito?, fechaNacimiento? }
// Registra a la persona contratada. Todavía NO tiene acceso al sistema —
// eso se hace aparte, en Config > Usuarios, eligiendo esta persona.
async function crear(req, res) {
  try {
    const {
      nombres, apellidos, numeroDocumento, telefono, correo,
      direccion, codigoDistrito, fechaNacimiento,
    } = req.body;

    if (!nombres || !apellidos || !correo) {
      return res.status(400).json({ mensaje: 'Nombres, apellidos y correo son obligatorios.' });
    }
    const errorFormato = validarDniTelefono(numeroDocumento, telefono);
    if (errorFormato) {
      return res.status(400).json({ mensaje: errorFormato });
    }
    if (esFechaFutura(fechaNacimiento)) {
      return res.status(400).json({ mensaje: 'La fecha de nacimiento no puede ser una fecha futura.' });
    }
    const validacionCorreo = await verificarDominioCorreo(correo);
    if (validacionCorreo.valido === false) {
      return res.status(400).json({ mensaje: validacionCorreo.mensaje });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('nombres', sql.NVarChar, nombres)
      .input('apellidos', sql.NVarChar, apellidos)
      .input('numeroDocumento', sql.NVarChar, numeroDocumento || null)
      .input('telefono', sql.NVarChar, telefono || null)
      .input('correo', sql.NVarChar, correo)
      .input('direccion', sql.NVarChar, direccion || null)
      .input('codigoDistrito', sql.Char(6), codigoDistrito || null)
      .input('fechaNacimiento', sql.Date, fechaNacimiento || null)
      .query(`
        INSERT INTO Personas (Nombres, Apellidos, NumeroDocumento, Telefono, CorreoElectronico, Direccion, CodigoDistrito, FechaNacimiento)
        OUTPUT INSERTED.PersonaID
        VALUES (@nombres, @apellidos, @numeroDocumento, @telefono, @correo, @direccion, @codigoDistrito, @fechaNacimiento)
      `);

    res.status(201).json({ mensaje: 'Persona registrada correctamente.', personaId: result.recordset[0].PersonaID });
  } catch (err) {
    console.error(err);
    if (esDuplicado(err)) { // UNIQUE: 2627 = restricción, 2601 = índice único filtrado
      return res.status(409).json({ mensaje: 'Ya existe una persona con ese correo o número de documento.' });
    }
    res.status(500).json({ mensaje: 'Error al registrar a la persona.' });
  }
}

// PUT /api/personas/:id
async function actualizar(req, res) {
  try {
    const { id } = req.params;
    const {
      nombres, apellidos, numeroDocumento, telefono, correo,
      direccion, codigoDistrito, fechaNacimiento,
    } = req.body;

    if (!nombres || !apellidos || !correo) {
      return res.status(400).json({ mensaje: 'Nombres, apellidos y correo son obligatorios.' });
    }
    const errorFormato = validarDniTelefono(numeroDocumento, telefono);
    if (errorFormato) {
      return res.status(400).json({ mensaje: errorFormato });
    }
    if (esFechaFutura(fechaNacimiento)) {
      return res.status(400).json({ mensaje: 'La fecha de nacimiento no puede ser una fecha futura.' });
    }
    const validacionCorreo = await verificarDominioCorreo(correo);
    if (validacionCorreo.valido === false) {
      return res.status(400).json({ mensaje: validacionCorreo.mensaje });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('nombres', sql.NVarChar, nombres)
      .input('apellidos', sql.NVarChar, apellidos)
      .input('numeroDocumento', sql.NVarChar, numeroDocumento || null)
      .input('telefono', sql.NVarChar, telefono || null)
      .input('correo', sql.NVarChar, correo)
      .input('direccion', sql.NVarChar, direccion || null)
      .input('codigoDistrito', sql.Char(6), codigoDistrito || null)
      .input('fechaNacimiento', sql.Date, fechaNacimiento || null)
      .query(`
        UPDATE Personas
        SET Nombres = @nombres, Apellidos = @apellidos, NumeroDocumento = @numeroDocumento,
            Telefono = @telefono, CorreoElectronico = @correo, Direccion = @direccion,
            CodigoDistrito = @codigoDistrito, FechaNacimiento = @fechaNacimiento
        WHERE PersonaID = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ mensaje: 'Persona no encontrada.' });
    }
    res.json({ mensaje: 'Datos actualizados correctamente.' });
  } catch (err) {
    console.error(err);
    if (esDuplicado(err)) { // UNIQUE: 2627 = restricción, 2601 = índice único filtrado
      return res.status(409).json({ mensaje: 'Ese correo o número de documento ya lo usa otra persona.' });
    }
    res.status(500).json({ mensaje: 'Error al actualizar a la persona.' });
  }
}

// PATCH /api/personas/:id/estado   Body: { activo: true|false }
// Si se DESACTIVA a la persona (ej. dejó de trabajar en la clínica),
// también se desactiva su Usuario del sistema si tenía uno — no debe
// quedar un acceso activo de alguien que ya no está contratado.
async function cambiarEstado(req, res) {
  try {
    const { id } = req.params;
    const { activo } = req.body;
    const pool = await getPool();

    await pool
      .request()
      .input('id', sql.Int, id)
      .input('activo', sql.Bit, activo)
      .query('UPDATE Personas SET Activo = @activo WHERE PersonaID = @id');

    if (!activo) {
      await pool
        .request()
        .input('id', sql.Int, id)
        .query('UPDATE Usuarios SET Activo = 0 WHERE PersonaID = @id');
    }

    res.json({ mensaje: 'Estado actualizado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al actualizar el estado.' });
  }
}

module.exports = { listar, crear, actualizar, cambiarEstado };