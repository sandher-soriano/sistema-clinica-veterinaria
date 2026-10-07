// controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { sql, getPool } = require('../config/db');
const { enviarCorreo, plantillaCorreo } = require('../utils/correo');

const TEMP_TOKEN_EXPIRA = '10m'; // tiempo para completar el paso de 2FA
const DISPOSITIVO_DIAS_CONFIANZA = 30; // "recordar este dispositivo"
const VIGENCIA_PASSWORD_DIAS_DEFECTO = 90; // si no hay fila en ConfiguracionSeguridad

function firmarTokenTemporal(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: TEMP_TOKEN_EXPIRA });
}

function firmarTokenSesion(user) {
  const payload = {
    usuarioId: user.UsuarioID,
    nombreCompleto: user.NombreCompleto,
    rol: user.NombreRol,
    accesoConfig: !!user.AccesoConfig,
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
  return { token, usuario: payload };
}

// El nombre y el correo YA NO viven en Usuarios: se heredan de Personas
// (PersonaID). Por eso todas las consultas de este archivo hacen JOIN con
// Personas en vez de leer columnas propias de Usuarios.
async function buscarUsuarioPorId(pool, usuarioId) {
  const result = await pool
    .request()
    .input('id', sql.Int, usuarioId)
    .query(`
      SELECT u.*, per.CorreoElectronico, (per.Nombres + ' ' + per.Apellidos) AS NombreCompleto,
             r.NombreRol, r.AccesoConfig
      FROM Usuarios u
      INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      INNER JOIN Roles r ON r.RolID = u.RolID
      WHERE u.UsuarioID = @id
    `);
  return result.recordset[0];
}

// ============================================================
// Vigencia de contraseña
// ============================================================

async function obtenerVigenciaPasswordDias(pool) {
  try {
    const result = await pool.request().query('SELECT TOP 1 VigenciaClaveDias FROM ConfiguracionSeguridad');
    if (result.recordset[0]) return result.recordset[0].VigenciaClaveDias;
  } catch (e) {
    // Si la tabla todavía no existe (no se corrió la migración), seguimos con el valor por defecto.
  }
  return VIGENCIA_PASSWORD_DIAS_DEFECTO;
}

// ============================================================
// Dispositivo de confianza (para no pedir el doble factor cada vez)
// ============================================================

function hashDispositivoToken(tokenPlano) {
  return crypto.createHash('sha256').update(tokenPlano).digest('hex');
}

async function registrarDispositivoConfiable(pool, usuarioId, ip) {
  const tokenPlano = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashDispositivoToken(tokenPlano);
  const expira = new Date(Date.now() + DISPOSITIVO_DIAS_CONFIANZA * 24 * 60 * 60 * 1000);

  await pool.request()
    .input('usuarioId', sql.Int, usuarioId)
    .input('hash', sql.NVarChar, tokenHash)
    .input('ip', sql.NVarChar, ip || null)
    .input('expira', sql.DateTime2, expira)
    .query(`
      INSERT INTO DispositivosConfiables (UsuarioID, TokenHash, DireccionIP, ExpiraEn)
      VALUES (@usuarioId, @hash, @ip, @expira)
    `);

  return tokenPlano;
}

async function esDispositivoConfiable(pool, usuarioId, tokenPlano) {
  if (!tokenPlano) return false;
  const tokenHash = hashDispositivoToken(tokenPlano);
  const result = await pool.request()
    .input('usuarioId', sql.Int, usuarioId)
    .input('hash', sql.NVarChar, tokenHash)
    .query(`
      SELECT DispositivoID FROM DispositivosConfiables
      WHERE UsuarioID = @usuarioId AND TokenHash = @hash AND ExpiraEn > SYSDATETIME()
    `);
  return !!result.recordset[0];
}

async function olvidarDispositivosDelUsuario(pool, usuarioId) {
  await pool.request()
    .input('usuarioId', sql.Int, usuarioId)
    .query('DELETE FROM DispositivosConfiables WHERE UsuarioID = @usuarioId');
}

/**
 * POST /api/auth/login
 * Body: { usuario, contrasena, dispositivoToken? }
 * Header opcional: X-Device-Token (alternativa a mandarlo en el body)
 *
 * "usuario" puede ser el NombreUsuario (tabla Usuarios) o el correo, que
 * ahora vive en Personas (heredado, no duplicado).
 */
async function login(req, res) {
  try {
    const { usuario, contrasena, dispositivoToken } = req.body;
    const tokenDispositivo = dispositivoToken || req.headers['x-device-token'];

    if (!usuario || !contrasena) {
      return res.status(400).json({ mensaje: 'Usuario y contraseña son obligatorios.' });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input('usuario', sql.NVarChar, usuario)
      .query(`
        SELECT u.UsuarioID, u.NombreUsuario, u.ContrasenaHash, u.Activo, u.RolID,
               u.TotpHabilitado, u.PasswordCambiadaEn,
               per.CorreoElectronico, (per.Nombres + ' ' + per.Apellidos) AS NombreCompleto,
               r.NombreRol, r.AccesoConfig
        FROM Usuarios u
        INNER JOIN Personas per ON per.PersonaID = u.PersonaID
        INNER JOIN Roles r ON r.RolID = u.RolID
        WHERE u.NombreUsuario = @usuario OR per.CorreoElectronico = @usuario
      `);

    const user = result.recordset[0];

    if (!user) {
      return res.status(401).json({ mensaje: 'Credenciales inválidas.' });
    }
    if (!user.Activo) {
      return res.status(403).json({ mensaje: 'Este usuario está deshabilitado. Contacta al administrador.' });
    }

    const passwordOk = await bcrypt.compare(contrasena, user.ContrasenaHash);
    if (!passwordOk) {
      return res.status(401).json({ mensaje: 'Credenciales inválidas.' });
    }

    // --- Vigencia de contraseña (aplica a todos los roles) ---
    const vigenciaDias = await obtenerVigenciaPasswordDias(pool);
    const cambiadaEn = user.PasswordCambiadaEn ? new Date(user.PasswordCambiadaEn) : new Date(0);
    const diasSinCambiar = (Date.now() - cambiadaEn.getTime()) / (1000 * 60 * 60 * 24);
    if (diasSinCambiar > vigenciaDias) {
      const tokenTemporal = firmarTokenTemporal({ usuarioId: user.UsuarioID, etapa: 'password_vencida' });
      return res.json({
        passwordVencida: true,
        mensaje: `Tu contraseña venció (vigencia de ${vigenciaDias} días). Debes cambiarla para continuar.`,
        tokenTemporal,
      });
    }

    // Veterinario: login normal, sin segundo paso.
    if (user.NombreRol !== 'Administrativo') {
      pool.request().input('id', sql.Int, user.UsuarioID)
        .query('UPDATE Usuarios SET UltimoAcceso = SYSDATETIME() WHERE UsuarioID = @id')
        .catch((e) => console.error('No se pudo actualizar UltimoAcceso:', e.message));
      return res.json(firmarTokenSesion(user));
    }

    // Administrativo: requiere 2FA, salvo que el dispositivo ya sea de confianza.
    if (!user.TotpHabilitado) {
      const tokenTemporal = firmarTokenTemporal({ usuarioId: user.UsuarioID, etapa: 'requiere_totp_setup' });
      return res.json({ requiereConfigurarTotp: true, rol: user.NombreRol, tokenTemporal });
    }

    const dispositivoOk = await esDispositivoConfiable(pool, user.UsuarioID, tokenDispositivo);
    if (dispositivoOk) {
      pool.request().input('id', sql.Int, user.UsuarioID)
        .query('UPDATE Usuarios SET UltimoAcceso = SYSDATETIME() WHERE UsuarioID = @id')
        .catch((e) => console.error('No se pudo actualizar UltimoAcceso:', e.message));
      return res.json(firmarTokenSesion(user));
    }

    const tokenTemporal = firmarTokenTemporal({ usuarioId: user.UsuarioID, etapa: 'requiere_totp' });
    return res.json({ requiereTotp: true, rol: user.NombreRol, tokenTemporal });
  } catch (err) {
    console.error('Error en login:', err);
    return res.status(500).json({ mensaje: 'Error interno del servidor.' });
  }
}

function decodificarTokenTemporal(tokenTemporal, etapaEsperada) {
  let payload;
  try {
    payload = jwt.verify(tokenTemporal, process.env.JWT_SECRET);
  } catch (e) {
    return { error: 'El código temporal expiró o es inválido. Vuelve a iniciar sesión.' };
  }
  if (payload.etapa !== etapaEsperada) {
    return { error: 'Token temporal no corresponde a este paso.' };
  }
  return { payload };
}

/**
 * POST /api/auth/totp/configurar
 * Body: { tokenTemporal }
 */
async function generarTotpSetup(req, res) {
  const { tokenTemporal } = req.body;
  const { payload, error } = decodificarTokenTemporal(tokenTemporal, 'requiere_totp_setup');
  if (error) return res.status(401).json({ mensaje: error });

  try {
    const pool = await getPool();
    const user = await buscarUsuarioPorId(pool, payload.usuarioId);
    if (!user) return res.status(404).json({ mensaje: 'Usuario no encontrado.' });

    const secreto = speakeasy.generateSecret({
      name: `Premier Can (${user.CorreoElectronico})`,
      length: 20,
    });

    const qrDataUrl = await qrcode.toDataURL(secreto.otpauth_url);

    const nuevoTokenTemporal = firmarTokenTemporal({
      usuarioId: user.UsuarioID,
      etapa: 'requiere_totp_setup',
      secretoPendiente: secreto.base32,
    });

    res.json({ qrDataUrl, secretoBase32: secreto.base32, tokenTemporal: nuevoTokenTemporal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al generar el código QR.' });
  }
}

/**
 * POST /api/auth/totp/confirmar
 * Body: { tokenTemporal, codigo, recordarDispositivo? }
 */
/**
 * Valida un código 2FA y lo "consume": cada código (paso de 30 s) sirve UNA
 * sola vez. El UPDATE condicional es atómico: si dos pedidos llegan con el
 * mismo código a la vez, solo uno pasa. Devuelve true si el código es válido
 * y no se había usado antes.
 */
async function consumirCodigoTotp(pool, usuarioId, secreto, codigo) {
  const r = speakeasy.totp.verifyDelta({ secret: secreto, encoding: 'base32', token: String(codigo || ''), window: 1 });
  if (!r) return false;
  const paso = Math.floor(Date.now() / 1000 / 30) + r.delta;
  const upd = await pool.request()
    .input('id', sql.Int, usuarioId)
    .input('paso', sql.BigInt, paso)
    .query('UPDATE Usuarios SET UltimoPasoTotp = @paso WHERE UsuarioID = @id AND (UltimoPasoTotp IS NULL OR UltimoPasoTotp < @paso)');
  return upd.rowsAffected[0] === 1;
}

async function confirmarTotpSetup(req, res) {
  const { tokenTemporal, codigo, recordarDispositivo } = req.body;
  const { payload, error } = decodificarTokenTemporal(tokenTemporal, 'requiere_totp_setup');
  if (error) return res.status(401).json({ mensaje: error });
  if (!payload.secretoPendiente) {
    return res.status(400).json({ mensaje: 'Primero genera el código QR.' });
  }

  const verif = speakeasy.totp.verifyDelta({
    secret: payload.secretoPendiente,
    encoding: 'base32',
    token: String(codigo || ''),
    window: 1,
  });
  if (!verif) {
    return res.status(401).json({ mensaje: 'El código no es válido. Revisa la hora de tu celular e intenta de nuevo.' });
  }

  try {
    const pool = await getPool();
    // El código usado para activar queda "consumido" (no sirve para entrar después)
    await pool.request()
      .input('id', sql.Int, payload.usuarioId)
      .input('secreto', sql.NVarChar, payload.secretoPendiente)
      .input('paso', sql.BigInt, Math.floor(Date.now() / 1000 / 30) + verif.delta)
      .query('UPDATE Usuarios SET TotpSecret = @secreto, TotpHabilitado = 1, UltimoPasoTotp = @paso, UltimoAcceso = SYSDATETIME() WHERE UsuarioID = @id');

    const user = await buscarUsuarioPorId(pool, payload.usuarioId);
    const sesion = firmarTokenSesion(user);

    if (recordarDispositivo) {
      sesion.dispositivoToken = await registrarDispositivoConfiable(pool, user.UsuarioID, req.ip);
    }

    res.json(sesion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al activar la verificación en dos pasos.' });
  }
}

/**
 * POST /api/auth/totp/verificar
 * Body: { tokenTemporal, codigo, recordarDispositivo? }
 */
async function verificarTotpLogin(req, res) {
  const { tokenTemporal, codigo, recordarDispositivo } = req.body;
  const { payload, error } = decodificarTokenTemporal(tokenTemporal, 'requiere_totp');
  if (error) return res.status(401).json({ mensaje: error });

  try {
    const pool = await getPool();
    const user = await buscarUsuarioPorId(pool, payload.usuarioId);
    if (!user || !user.TotpSecret) {
      return res.status(400).json({ mensaje: 'Este usuario no tiene la verificación en dos pasos configurada.' });
    }

    const valido = await consumirCodigoTotp(pool, user.UsuarioID, user.TotpSecret, codigo);
    if (!valido) {
      return res.status(401).json({ mensaje: 'Código incorrecto o ya usado. Espera el siguiente código de tu app e intenta de nuevo.' });
    }

    await pool.request().input('id', sql.Int, user.UsuarioID)
      .query('UPDATE Usuarios SET UltimoAcceso = SYSDATETIME() WHERE UsuarioID = @id');

    const sesion = firmarTokenSesion(user);

    if (recordarDispositivo) {
      sesion.dispositivoToken = await registrarDispositivoConfiable(pool, user.UsuarioID, req.ip);
    }

    res.json(sesion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al verificar el código.' });
  }
}

/**
 * POST /api/auth/cambiar-password-vencida
 * Body: { tokenTemporal, nuevaContrasena }
 */
async function cambiarPasswordVencida(req, res) {
  const { tokenTemporal, nuevaContrasena } = req.body;
  const { payload, error } = decodificarTokenTemporal(tokenTemporal, 'password_vencida');
  if (error) return res.status(401).json({ mensaje: error });

  if (!nuevaContrasena || nuevaContrasena.length < 6) {
    return res.status(400).json({ mensaje: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const pool = await getPool();
    const nuevoHash = await bcrypt.hash(nuevaContrasena, 12);

    await pool.request()
      .input('id', sql.Int, payload.usuarioId)
      .input('hash', sql.NVarChar, nuevoHash)
      .query('UPDATE Usuarios SET ContrasenaHash = @hash, PasswordCambiadaEn = SYSDATETIME() WHERE UsuarioID = @id');

    await olvidarDispositivosDelUsuario(pool, payload.usuarioId);

    res.json({ mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al actualizar la contraseña.' });
  }
}

/**
 * GET /api/auth/me
 */
async function me(req, res) {
  return res.json({ usuario: req.usuario });
}

// ============================================================
// Recuperar contraseña
// ============================================================

/**
 * POST /api/auth/olvide-password
 * Body: { correo }
 */
async function olvidePassword(req, res) {
  const { correo } = req.body;
  if (!correo) return res.status(400).json({ mensaje: 'El correo es obligatorio.' });

  const mensajeGenerico = { mensaje: 'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.' };

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query(`
        SELECT u.UsuarioID, per.CorreoElectronico, (per.Nombres + ' ' + per.Apellidos) AS NombreCompleto
        FROM Usuarios u
        INNER JOIN Personas per ON per.PersonaID = u.PersonaID
        WHERE per.CorreoElectronico = @correo AND u.Activo = 1
      `);

    const user = result.recordset[0];
    if (!user) return res.json(mensajeGenerico); // no revela si el correo existe

    const tokenPlano = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
    const expira = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    await pool.request()
      .input('id', sql.Int, user.UsuarioID)
      .input('hash', sql.NVarChar, tokenHash)
      .input('expira', sql.DateTime2, expira)
      .query('UPDATE Usuarios SET ResetTokenHash = @hash, ResetTokenExpira = @expira WHERE UsuarioID = @id');

    const origenFrontend = process.env.FRONTEND_ORIGIN || 'http://localhost:5500';
    const enlace = `${origenFrontend}/restablecer-password.html?correo=${encodeURIComponent(user.CorreoElectronico)}&token=${tokenPlano}`;

    const envio = await enviarCorreo({
      para: user.CorreoElectronico,
      asunto: 'Restablece tu contraseña — Premier Can',
      html: plantillaCorreo({
        titulo: 'Restablece tu contraseña',
        contenido: `
          <p>Hola ${user.NombreCompleto},</p>
          <p>Recibimos una solicitud para restablecer tu contraseña. Este enlace vence en 30 minutos:</p>
          <p style="text-align:center;margin:22px 0"><a href="${enlace}" style="background:#00606a;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700">Crear nueva contraseña</a></p>
          <p style="color:#6b7f82;font-size:13px">Si tú no pediste esto, ignora este correo: tu contraseña no cambiará.</p>`,
      }),
    });

    if (!envio.enviado) {
      // SEGURIDAD: el enlace NUNCA va en la respuesta web (cualquiera podría pedir
      // el de otra persona y quedarse con su cuenta). Solo se muestra en la consola
      // del servidor, salvo que se active a propósito para pruebas locales.
      console.log('📧 Correo NO enviado. Enlace de restablecimiento:', enlace);
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
 * POST /api/auth/restablecer-password
 * Body: { correo, token, nuevaContrasena, codigoTotp? }
 */
async function restablecerPassword(req, res) {
  const { correo, token, nuevaContrasena, codigoTotp } = req.body;

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
      .query(`
        SELECT u.*, r.NombreRol
        FROM Usuarios u
        INNER JOIN Personas per ON per.PersonaID = u.PersonaID
        INNER JOIN Roles r ON r.RolID = u.RolID
        WHERE per.CorreoElectronico = @correo
      `);
    const user = result.recordset[0];

    if (!user || !user.ResetTokenHash || !user.ResetTokenExpira) {
      return res.status(400).json({ mensaje: 'El enlace no es válido. Solicita uno nuevo.' });
    }
    if (new Date(user.ResetTokenExpira) < new Date()) {
      return res.status(400).json({ mensaje: 'El enlace venció. Solicita uno nuevo.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (tokenHash !== user.ResetTokenHash) {
      return res.status(400).json({ mensaje: 'El enlace no es válido. Solicita uno nuevo.' });
    }

    if (user.NombreRol === 'Administrativo' && user.TotpHabilitado) {
      if (!codigoTotp) {
        return res.status(400).json({ mensaje: 'Esta cuenta requiere el código de tu app autenticadora.', requiereTotp: true });
      }
      const valido = await consumirCodigoTotp(pool, user.UsuarioID, user.TotpSecret, codigoTotp);
      if (!valido) {
        return res.status(401).json({ mensaje: 'Código de autenticador incorrecto o ya usado.', requiereTotp: true });
      }
    }

    const nuevoHash = await bcrypt.hash(nuevaContrasena, 12);
    await pool.request()
      .input('id', sql.Int, user.UsuarioID)
      .input('hash', sql.NVarChar, nuevoHash)
      .query('UPDATE Usuarios SET ContrasenaHash = @hash, ResetTokenHash = NULL, ResetTokenExpira = NULL, PasswordCambiadaEn = SYSDATETIME() WHERE UsuarioID = @id');

    await olvidarDispositivosDelUsuario(pool, user.UsuarioID);

    res.json({ mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'Error al restablecer la contraseña.' });
  }
}

module.exports = {
  login, me,
  generarTotpSetup, confirmarTotpSetup, verificarTotpLogin,
  olvidePassword, restablecerPassword,
  cambiarPasswordVencida,
};