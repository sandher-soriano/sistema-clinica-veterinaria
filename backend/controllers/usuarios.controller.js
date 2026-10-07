// controllers/usuarios.controller.js
// Ejemplo de endpoints protegidos: solo un usuario con rol "Administrativo"
// (AccesoConfig = 1) puede llegar aquí, gracias al middleware requireConfigAccess.
const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { olvidarSesionesDe } = require('../middleware/auth');
const esDuplicado = (err) => err && (err.number === 2627 || err.number === 2601);
const { HORA_APERTURA, HORA_APERTURA_TEXTO, HORA_CIERRE_TEXTO } = require('../utils/horarios');

// Valida un arreglo de horarios de trabajo para un veterinario.
// Cada entrada: { diaSemana: 1-6 (1=Lunes ... 6=Sábado), horaInicio: 'HH:MM', horaFin: 'HH:MM' }
// Devuelve un mensaje de error, o null si todo está bien.
function validarHorariosVeterinario(horarios) {
  if (!Array.isArray(horarios) || horarios.length === 0) {
    return 'Debes asignar al menos un día y horario de trabajo para el veterinario.';
  }
  const diasVistos = new Set();
  const horaRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

  for (const h of horarios) {
    const { diaSemana, horaInicio, horaFin } = h || {};
    if (!Number.isInteger(diaSemana) || diaSemana < 1 || diaSemana > 6) {
      return 'Cada horario debe indicar un día válido (lunes a sábado).';
    }
    if (diasVistos.has(diaSemana)) {
      return 'No puedes asignar el mismo día dos veces.';
    }
    diasVistos.add(diaSemana);
    if (!horaRegex.test(horaInicio) || !horaRegex.test(horaFin)) {
      return 'La hora de inicio y de fin de cada horario deben tener el formato HH:MM.';
    }
    if (horaInicio >= horaFin) {
      return 'La hora de inicio debe ser menor que la hora de fin.';
    }
    if (horaInicio < HORA_APERTURA) {
      return `El horario del veterinario debe empezar dentro del horario de atención de la clínica: no antes de las ${HORA_APERTURA_TEXTO}. La clínica cierra a las ${HORA_CIERRE_TEXTO}.`;
    }
  }
  return null;
}

// GET /api/usuarios
// Devuelve el staff (Usuarios, con nombre/correo heredados de Personas) Y
// los clientes que ya tienen acceso al portal (Propietarios con contraseña
// asignada), todo en una sola lista, para administrarlos desde un solo lugar.
async function listar(req, res) {
  try {
    const pool = await getPool();

    const staffResult = await pool.request().query(`
      SELECT u.UsuarioID, (per.Nombres + ' ' + per.Apellidos) AS NombreCompleto,
             per.CorreoElectronico, u.NombreUsuario,
             u.Activo, u.UltimoAcceso, r.NombreRol
      FROM Usuarios u
      INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      INNER JOIN Roles r ON r.RolID = u.RolID
      ORDER BY per.Nombres
    `);

    const clientesResult = await pool.request().query(`
      SELECT PropietarioID AS UsuarioID, (Nombres + ' ' + Apellidos) AS NombreCompleto,
             CorreoElectronico, NULL AS NombreUsuario, Activo, NULL AS UltimoAcceso
      FROM Propietarios
      WHERE ContrasenaHash IS NOT NULL
      ORDER BY Nombres
    `);

    const staff = staffResult.recordset.map((u) => ({ ...u, esCliente: false }));
    const clientes = clientesResult.recordset.map((c) => ({ ...c, NombreRol: 'Cliente', esCliente: true }));

    res.json([...staff, ...clientes]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar usuarios.' });
  }
}

// POST /api/usuarios
// Body: { personaId, nombreUsuario, contrasena, rolId, horarios? }
//
// horarios es OBLIGATORIO solo cuando el rol elegido es "Veterinario":
// [{ diaSemana: 1-6, horaInicio: 'HH:MM', horaFin: 'HH:MM' }, ...]
// Esos son los días y el rango de horas en que ese veterinario trabaja
// (siempre dentro del horario de atención de la clínica), y es lo que
// usa citas.controller.js para asignarlo automáticamente a una cita.
//
// IMPORTANTE: ya NO se piden nombreCompleto/correo aquí. Esos datos se
// heredan de una Persona que ya debe existir (se registra antes, en
// Config > Personal). Esto evita el error de crear la tabla Usuario con
// datos personales propios, en vez de heredarlos de Persona.
async function crear(req, res) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  try {
    const { personaId, nombreUsuario, contrasena, rolId, horarios } = req.body;

    if (!personaId || !nombreUsuario || !contrasena || !rolId) {
      return res.status(400).json({ mensaje: 'Persona, nombre de usuario, contraseña y rol son obligatorios.' });
    }
    if (contrasena.length < 6) {
      return res.status(400).json({ mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const persona = await pool.request()
      .input('personaId', sql.Int, personaId)
      .query('SELECT PersonaID FROM Personas WHERE PersonaID = @personaId AND Activo = 1');
    if (persona.recordset.length === 0) {
      return res.status(400).json({
        mensaje: 'Esa persona no existe o está inactiva. Regístrala primero en Config > Personal.',
      });
    }

    const rolResult = await pool.request()
      .input('rolId', sql.Int, rolId)
      .query('SELECT NombreRol FROM Roles WHERE RolID = @rolId');
    if (rolResult.recordset.length === 0) {
      return res.status(400).json({ mensaje: 'Rol inválido.' });
    }
    const esVeterinario = rolResult.recordset[0].NombreRol === 'Veterinario';

    if (esVeterinario) {
      const errorHorarios = validarHorariosVeterinario(horarios);
      if (errorHorarios) {
        return res.status(400).json({ mensaje: errorHorarios });
      }
    }

    const hash = await bcrypt.hash(contrasena, 12);

    await transaction.begin();

    const insertUsuario = await new sql.Request(transaction)
      .input('personaId', sql.Int, personaId)
      .input('nombreUsuario', sql.NVarChar, nombreUsuario)
      .input('hash', sql.NVarChar, hash)
      .input('rolId', sql.Int, rolId)
      .query(`
        INSERT INTO Usuarios (PersonaID, NombreUsuario, ContrasenaHash, RolID)
        OUTPUT INSERTED.UsuarioID
        VALUES (@personaId, @nombreUsuario, @hash, @rolId)
      `);
    const usuarioId = insertUsuario.recordset[0].UsuarioID;

    if (esVeterinario) {
      for (const h of horarios) {
        await new sql.Request(transaction)
          .input('usuarioId', sql.Int, usuarioId)
          .input('diaSemana', sql.TinyInt, h.diaSemana)
          .input('horaInicio', sql.VarChar(5), h.horaInicio)
          .input('horaFin', sql.VarChar(5), h.horaFin)
          .query(`
            INSERT INTO HorariosVeterinario (UsuarioID, DiaSemana, HoraInicio, HoraFin)
            VALUES (@usuarioId, @diaSemana, @horaInicio, @horaFin)
          `);
      }
    }

    await transaction.commit();

    await registrarAuditoria(pool, { tabla: 'Usuarios', registroId: 0, accion: 'Crear', usuarioId: req.usuario.usuarioId, detalle: `Creó el usuario ${req.body.nombreUsuario || ''}` });
    res.status(201).json({ mensaje: 'Usuario creado correctamente.' });
  } catch (err) {
    console.error(err);
    try { await transaction.rollback(); } catch (_) { /* ya estaba cerrada */ }

    if (esDuplicado(err)) { // UNIQUE: 2627 = restricción, 2601 = índice único filtrado
      return res.status(409).json({
        mensaje: 'Ese nombre de usuario ya existe, o esa persona ya tiene un usuario asignado (una persona = un solo usuario).',
      });
    }
    res.status(500).json({ mensaje: 'Error al crear el usuario.' });
  }
}

// GET /api/usuarios/:id/horarios
// Devuelve los días y horas de trabajo de un veterinario (vacío si es
// Administrativo o si todavía no tiene horarios asignados).
async function listarHorarios(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('usuarioId', sql.Int, id)
      .query(`
        SELECT HorarioID, DiaSemana, CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio,
               CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
        FROM HorariosVeterinario
        WHERE UsuarioID = @usuarioId
        ORDER BY DiaSemana
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al obtener los horarios.' });
  }
}

// PATCH /api/usuarios/:id/estado   Body: { activo: true|false, esCliente: true|false }
async function cambiarEstado(req, res) {
  try {
    const { id } = req.params;
    const { activo, esCliente } = req.body;
    const pool = await getPool();

    if (esCliente) {
      await pool
        .request()
        .input('id', sql.Int, id)
        .input('activo', sql.Bit, activo)
        .query('UPDATE Propietarios SET Activo = @activo WHERE PropietarioID = @id');
    } else {
      await pool
        .request()
        .input('id', sql.Int, id)
        .input('activo', sql.Bit, activo)
        .query('UPDATE Usuarios SET Activo = @activo WHERE UsuarioID = @id');
      olvidarSesionesDe(Number(id)); // si se desactivó, su sesión abierta deja de valer YA
    }

    await registrarAuditoria(pool, { tabla: esCliente ? 'Propietarios' : 'Usuarios', registroId: Number(id), accion: activo ? 'Activar' : 'Desactivar', usuarioId: req.usuario.usuarioId, detalle: `${activo ? 'Activó' : 'Desactivó'} ${esCliente ? 'la cuenta de cliente' : 'el usuario'} #${id}` });
    res.json({ mensaje: 'Estado actualizado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al actualizar el estado.' });
  }
}

// GET /api/usuarios/veterinarios/lista
// Endpoint LIVIANO (sin requireConfigAccess): cualquier usuario logueado
// puede pedir la lista de veterinarios activos, para elegir el
// "Veterinario Responsable" al registrar una consulta.
async function listarVeterinarios(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT u.UsuarioID, (per.Nombres + ' ' + per.Apellidos) AS NombreCompleto
      FROM Usuarios u
      INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      INNER JOIN Roles r ON r.RolID = u.RolID
      WHERE r.NombreRol = 'Veterinario' AND u.Activo = 1
      ORDER BY per.Nombres
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al listar veterinarios.' });
  }
}

module.exports = { listar, crear, cambiarEstado, listarVeterinarios, listarHorarios };