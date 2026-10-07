// controllers/propietarios.controller.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { enviarCorreo, plantillaCorreo } = require('../utils/correo');
const { consultarDni } = require('../utils/reniec');

// GET /api/propietarios/validar-dni/:dni
// Se llama ANTES de guardar un propietario nuevo, cuando el usuario
// termina de escribir el DNI en el formulario. No guarda nada todavía
// — solo confirma que el DNI existe y devuelve el nombre real según
// RENIEC, para que el formulario se autocomplete.
async function validarDni(req, res) {
  try {
    const { dni } = req.params;
    const resultado = await consultarDni(dni);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ valido: false, mensaje: 'Error al validar el DNI.' });
  }
}

// GET /api/propietarios?buscar=texto
// Usado por el formulario de "Registrar paciente" para buscar un dueño ya
// existente (por nombre, apellido, correo o teléfono) antes de crear uno nuevo.
async function buscar(req, res) {
  try {
    const { buscar = '' } = req.query;
    const pool = await getPool();

    const result = await pool
      .request()
      .input('buscar', sql.NVarChar, `%${buscar}%`)
      .query(`
        SELECT TOP 10 PropietarioID, Nombres, Apellidos, Telefono, CorreoElectronico, NumeroDocumento
        FROM Propietarios
        WHERE Activo = 1
          AND (Nombres LIKE @buscar OR Apellidos LIKE @buscar
               OR CorreoElectronico LIKE @buscar OR Telefono LIKE @buscar)
        ORDER BY Nombres
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al buscar propietarios.' });
  }
}

// POST /api/propietarios/:id/generar-acceso   (solo Administrativo)
// Genera una contraseña temporal para que un dueño de mascota pueda
// entrar a la app/portal de clientes, y se la manda por correo.
// Si no hay proveedor de correo configurado en el backend, la devuelve
// en la respuesta (modo desarrollo) para que puedas seguir probando.
async function generarAcceso(req, res) {
  try {
    const { id } = req.params;
    const pool = await getPool();

    const propietarioResult = await pool
      .request()
      .input('id', sql.Int, id)
      .query('SELECT PropietarioID, Nombres, CorreoElectronico FROM Propietarios WHERE PropietarioID = @id');
    const propietario = propietarioResult.recordset[0];

    if (!propietario) return res.status(404).json({ mensaje: 'Propietario no encontrado.' });
    if (!propietario.CorreoElectronico) {
      return res.status(400).json({ mensaje: 'Este propietario no tiene correo registrado, no se le puede dar acceso.' });
    }

    const contrasenaTemporal = crypto.randomBytes(4).toString('hex'); // 8 caracteres
    const hash = await bcrypt.hash(contrasenaTemporal, 12);

    await pool
      .request()
      .input('id', sql.Int, id)
      .input('hash', sql.NVarChar, hash)
      .query('UPDATE Propietarios SET ContrasenaHash = @hash, DebeCambiarPassword = 1 WHERE PropietarioID = @id');

    const envio = await enviarCorreo({
      para: propietario.CorreoElectronico,
      asunto: 'Tu acceso al portal de clientes — Premier Can',
      html: plantillaCorreo({
        titulo: '¡Bienvenido al portal de clientes! 🐶🐱',
        contenido: `
          <p>Hola ${propietario.Nombres},</p>
          <p>Ya puedes ingresar al portal y a la app de Premier Can para ver a tus mascotas, sus vacunas y agendar citas:</p>
          <p style="background:#f3f8f8;border-radius:12px;padding:14px 16px">
            <strong>Correo:</strong> ${propietario.CorreoElectronico}<br/>
            <strong>Contraseña temporal:</strong> <span style="font-size:18px;font-weight:800;letter-spacing:1px">${contrasenaTemporal}</span>
          </p>
          <p>Al ingresar por primera vez te pediremos crear tu propia contraseña.</p>`,
      }),
    });

    if (!envio.enviado) {
      // Sin correo (Mailgun sin configurar o rechazando el envío): el staff ve
      // la contraseña en pantalla y se la entrega al cliente en persona.
      console.log(`📧 Correo NO enviado (${envio.motivo}). Contraseña temporal para ${propietario.CorreoElectronico}:`, contrasenaTemporal);
      return res.json({
        mensaje: 'Acceso generado, pero el correo no se pudo enviar.',
        motivoCorreo: envio.motivo,
        contrasenaTemporalDev: contrasenaTemporal,
      });
    }

    await registrarAuditoria(pool, { tabla: 'Propietarios', registroId: Number(req.params.id), accion: 'Enviar', usuarioId: req.usuario.usuarioId, detalle: `Generó acceso al portal para el propietario #${req.params.id}` });
    res.json({ mensaje: 'Acceso generado y enviado por correo al cliente.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al generar el acceso.' });
  }
}

module.exports = { buscar, generarAcceso, validarDni };