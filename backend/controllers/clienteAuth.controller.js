// controllers/clienteAuth.controller.js
//
// Login separado para CLIENTES (dueños de mascotas). Es parecido al
// login del staff (auth.controller.js), pero:
// - mira la tabla Propietarios, no Usuarios
// - no tiene 2FA (eso es solo para el rol Administrativo del staff)
// - el token que genera trae "tipo: cliente" para que el middleware
//   sepa distinguir una sesión de cliente de una sesión de staff
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sql, getPool } = require('../config/db');
const { enviarCorreo, plantillaCorreo } = require('../utils/correo');
const { huellaContrasena } = require('../middleware/auth');
const { enviarBienvenidaSiEsPrimeraVez } = require('../utils/recordatorios-auto');

const DIAS_RECORDAR_DISPOSITIVO = 30;

/**
 * Firma la sesión del cliente.
 * recordar = true ("Recordar este dispositivo por 30 días"): la sesión dura
 * 30 días en vez de JWT_EXPIRES_IN, y lleva una huella de la contraseña
 * actual. Si el cliente cambia su contraseña (p. ej. perdió el celular) o la
 * clínica deshabilita la cuenta, esas sesiones dejan de valer al instante
 * (lo revisa middleware/auth.js -> verifyClienteToken).
 */
function firmarTokenCliente(propietario, { recordar = false } = {}) {
  const payload = {
    tipo: 'cliente',
    propietarioId: propietario.PropietarioID,
    nombreCompleto: `${propietario.Nombres} ${propietario.Apellidos}`,
    debeCambiarPassword: !!propietario.DebeCambiarPassword,
    ...(recordar ? { recordado: true, huella: huellaContrasena(propietario.ContrasenaHash) } : {}),
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: recordar ? `${DIAS_RECORDAR_DISPOSITIVO}d` : (process.env.JWT_EXPIRES_IN || '8h'),
  });
  const { huella, ...publico } = payload; // la huella no hace falta en el navegador
  return { token, propietario: publico };
}

/**
 * POST /api/cliente/auth/login
 * Body: { correo, contrasena }
 */
async function login(req, res) {
  try {
    const { correo, contrasena, recordar } = req.body;
    if (!correo || !contrasena) {
      return res.status(400).json({ mensaje: 'Correo y contraseña son obligatorios.' });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM Propietarios WHERE CorreoElectronico = @correo');

    const propietario = result.recordset[0];

    if (!propietario || !propietario.ContrasenaHash) {
      return res.status(401).json({ mensaje: 'Credenciales inválidas. Si nunca iniciaste sesión, pide tu contraseña en la clínica.' });
    }
    if (!propietario.Activo) {
      return res.status(403).json({ mensaje: 'Esta cuenta está deshabilitada. Contacta a la clínica.' });
    }

    const passwordOk = await bcrypt.compare(contrasena, propietario.ContrasenaHash);
    if (!passwordOk) {
      return res.status(401).json({ mensaje: 'Credenciales inválidas.' });
    }

    // Primera vez que entra: aviso de bienvenida (app + correo) con el número
    // de soporte. Si fallara, el login sigue igual: la bienvenida es un extra.
    enviarBienvenidaSiEsPrimeraVez(pool, propietario)
      .catch((err) => console.error('No se pudo enviar la bienvenida:', err.message));

    res.json(firmarTokenCliente(propietario, { recordar: recordar === true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error interno del servidor.' });
  }
}

/** GET /api/cliente/auth/me */
async function me(req, res) {
  res.json({ propietario: req.propietario });
}

/**
 * POST /api/cliente/auth/olvide-password
 * Body: { correo }
 * Igual mecanismo que para el staff: enlace de un solo uso, vence en 30 min.
 */
async function olvidePassword(req, res) {
  const { correo } = req.body;
  if (!correo) return res.status(400).json({ mensaje: 'El correo es obligatorio.' });

  const mensajeGenerico = { mensaje: 'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.' };

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT PropietarioID, Nombres, CorreoElectronico FROM Propietarios WHERE CorreoElectronico = @correo AND Activo = 1');

    const propietario = result.recordset[0];
    if (!propietario) return res.json(mensajeGenerico);

    const tokenPlano = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
    const expira = new Date(Date.now() + 30 * 60 * 1000);

    await pool.request()
      .input('id', sql.Int, propietario.PropietarioID)
      .input('hash', sql.NVarChar, tokenHash)
      .input('expira', sql.DateTime2, expira)
      .query('UPDATE Propietarios SET ResetTokenHash = @hash, ResetTokenExpira = @expira WHERE PropietarioID = @id');

    const origenFrontend = process.env.FRONTEND_ORIGIN || 'http://localhost:5500';
    const enlace = `${origenFrontend}/cliente/restablecer-password.html?correo=${encodeURIComponent(propietario.CorreoElectronico)}&token=${tokenPlano}`;

    const envio = await enviarCorreo({
      para: propietario.CorreoElectronico,
      asunto: 'Restablece tu contraseña — Premier Can',
      html: plantillaCorreo({
        titulo: 'Restablece tu contraseña',
        contenido: `
          <p>Hola ${propietario.Nombres},</p>
          <p>Recibimos una solicitud para restablecer tu contraseña. Este enlace vence en 30 minutos:</p>
          <p style="text-align:center;margin:22px 0"><a href="${enlace}" style="background:#00606a;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">Crear nueva contraseña</a></p>
          <p style="color:#6b7f82;font-size:13px">Si tú no pediste esto, ignora este correo: tu contraseña no cambiará.</p>`,
      }),
    });

    if (!envio.enviado) {
      // SEGURIDAD: igual que en auth.controller.js, el enlace nunca va en la respuesta web.
      console.log('📧 Correo NO enviado. Enlace de restablecimiento (cliente):', enlace);
      if (process.env.CORREO_MODO_DESARROLLO === 'true') return res.json({ ...mensajeGenerico, enlaceDev: enlace });
      return res.json(mensajeGenerico);
    }

    res.json(mensajeGenerico);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al procesar la solicitud.' });
  }
}

/**
 * POST /api/cliente/auth/restablecer-password
 * Body: { correo, token, nuevaContrasena }
 */
async function restablecerPassword(req, res) {
  const { correo, token, nuevaContrasena } = req.body;

  if (!correo || !token || !nuevaContrasena) {
    return res.status(400).json({ mensaje: 'Faltan datos obligatorios.' });
  }
  if (nuevaContrasena.length < 6) {
    return res.status(400).json({ mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM Propietarios WHERE CorreoElectronico = @correo');
    const propietario = result.recordset[0];

    if (!propietario || !propietario.ResetTokenHash || !propietario.ResetTokenExpira) {
      return res.status(400).json({ mensaje: 'El enlace no es válido. Solicita uno nuevo.' });
    }
    if (new Date(propietario.ResetTokenExpira) < new Date()) {
      return res.status(400).json({ mensaje: 'El enlace venció. Solicita uno nuevo.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (tokenHash !== propietario.ResetTokenHash) {
      return res.status(400).json({ mensaje: 'El enlace no es válido. Solicita uno nuevo.' });
    }

    const nuevoHash = await bcrypt.hash(nuevaContrasena, 12);
    await pool.request()
      .input('id', sql.Int, propietario.PropietarioID)
      .input('hash', sql.NVarChar, nuevoHash)
      .query('UPDATE Propietarios SET ContrasenaHash = @hash, ResetTokenHash = NULL, ResetTokenExpira = NULL WHERE PropietarioID = @id');

    res.json({ mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al restablecer la contraseña.' });
  }
}

/**
 * POST /api/cliente/auth/cambiar-password-inicial
 * Requiere sesión de cliente ya iniciada (con la contraseña temporal).
 * Body: { nuevaContrasena }
 * Se usa SOLO la primera vez, cuando debeCambiarPassword está en 1.
 */
async function cambiarPasswordInicial(req, res) {
  const { nuevaContrasena } = req.body;
  if (!nuevaContrasena || nuevaContrasena.length < 6) {
    return res.status(400).json({ mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const pool = await getPool();
    const nuevoHash = await bcrypt.hash(nuevaContrasena, 12);

    // SOLO mientras tenga la contraseña temporal (DebeCambiarPassword = 1).
    // Antes servía siempre: quien robara una sesión podía cambiar la clave sin
    // conocer la actual y quedarse con la cuenta.
    const upd = await pool.request()
      .input('id', sql.Int, req.propietario.propietarioId)
      .input('hash', sql.NVarChar, nuevoHash)
      .query('UPDATE Propietarios SET ContrasenaHash = @hash, DebeCambiarPassword = 0 WHERE PropietarioID = @id AND DebeCambiarPassword = 1');
    if (!upd.rowsAffected[0]) {
      return res.status(403).json({ mensaje: 'Tu contraseña ya fue creada. Si quieres cambiarla usa "¿Olvidé mi contraseña?".' });
    }

    // Reemitimos el token ya sin la bandera "debeCambiarPassword", para
    // que el resto del portal se desbloquee sin pedirle loguearse de nuevo.
    // Si este dispositivo estaba recordado, lo sigue estando (con la huella
    // de la contraseña NUEVA; las sesiones recordadas de otros equipos caen).
    const result = await pool.request()
      .input('id', sql.Int, req.propietario.propietarioId)
      .query('SELECT * FROM Propietarios WHERE PropietarioID = @id');

    res.json(firmarTokenCliente(result.recordset[0], { recordar: !!req.propietario.recordado }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al cambiar la contraseña.' });
  }
}

module.exports = { login, me, olvidePassword, restablecerPassword, cambiarPasswordInicial };
