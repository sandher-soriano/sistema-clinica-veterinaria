// middleware/auth.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../config/db');

/**
 * Verifica que la petición traiga un JWT válido en el header:
 *   Authorization: Bearer <token>
 * Si es válido, deja los datos del usuario en req.usuario.
 */
// Estado del usuario en la base, con un caché corto (20 s) para no consultar
// en cada petición. Clave: usuario + momento en que se emitió el token.
const cacheSesiones = new Map();
const CACHE_MS = 20 * 1000;

async function estadoSesionStaff(usuarioId, iat) {
  const clave = `${usuarioId}|${iat}`;
  const enCache = cacheSesiones.get(clave);
  if (enCache && enCache.expira > Date.now()) return enCache.datos;

  const pool = await getPool();
  // PasswordCambiadaEn se guarda con SYSDATETIME() (hora local de la PC) y "iat"
  // viene en UTC: la conversión se hace en SQL para comparar en la misma hora.
  // +1 s de margen: el login que sigue justo a un cambio de contraseña es válido.
  const r = await pool.request()
    .input('id', sql.Int, usuarioId)
    .input('iat', sql.BigInt, iat)
    .query(`
      SELECT u.Activo, ro.NombreRol, ro.AccesoConfig,
             CASE WHEN u.PasswordCambiadaEn > DATEADD(SECOND, 1,
                    DATEADD(MINUTE, DATEDIFF(MINUTE, SYSUTCDATETIME(), SYSDATETIME()),
                            DATEADD(SECOND, @iat, CAST('1970-01-01' AS DATETIME2))))
                  THEN 1 ELSE 0 END AS ClaveCambiada
      FROM Usuarios u
      INNER JOIN Roles ro ON ro.RolID = u.RolID
      WHERE u.UsuarioID = @id
    `);
  const datos = r.recordset[0] || null;
  cacheSesiones.set(clave, { datos, expira: Date.now() + CACHE_MS });
  if (cacheSesiones.size > 1000) cacheSesiones.clear();
  return datos;
}

/** Llamar al desactivar un usuario o cambiar su rol, para que aplique al instante. */
function olvidarSesionesDe(usuarioId) {
  for (const k of cacheSesiones.keys()) if (k.startsWith(`${usuarioId}|`)) cacheSesiones.delete(k);
}

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ mensaje: 'No autenticado. Falta el token.' });
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ mensaje: 'Token inválido o expirado.' });
  }

  // Todos los tokens se firman con la misma clave, así que hay que mirar QUÉ
  // token es: solo una sesión completa de staff sirve aquí. Se rechazan:
  //  - los tokens temporales del login (etapa: requiere_totp, password_vencida...),
  //    que solo prueban la contraseña: aceptarlos saltaría la verificación en 2 pasos;
  //  - los de clientes (tipo: 'cliente') y los de notificaciones de la app (tipo: 'notif-app').
  if (payload.etapa || payload.tipo || !payload.usuarioId || !payload.rol) {
    return res.status(401).json({ mensaje: 'Este token no corresponde a una sesión del personal.' });
  }

  // La sesión deja de valer si el usuario fue desactivado o cambió su
  // contraseña después de iniciarla (antes seguía entrando hasta 8 horas).
  let estado;
  try {
    estado = await estadoSesionStaff(payload.usuarioId, payload.iat || 0);
  } catch (err) {
    return res.status(503).json({ mensaje: 'No se pudo verificar tu sesión. Intenta de nuevo.' });
  }
  if (!estado || !estado.Activo) {
    return res.status(401).json({ mensaje: 'Tu usuario fue desactivado. Comunícate con el administrador.' });
  }
  if (estado.ClaveCambiada) {
    return res.status(401).json({ mensaje: 'Tu contraseña cambió. Inicia sesión de nuevo.' });
  }

  // Rol y permisos tomados de la base (si el administrador los cambia, aplica al instante)
  req.usuario = { ...payload, rol: estado.NombreRol, accesoConfig: !!estado.AccesoConfig };
  next();
}

/**
 * Middleware de autorización: solo deja pasar si el rol del usuario
 * tiene acceso a Config (Administrativo). Úsalo DESPUÉS de verifyToken
 * en cualquier ruta relacionada a Usuarios/Config.
 *
 * Esto es lo que realmente protege "/api/usuarios" en el servidor —
 * ocultar el botón "Config" en el HTML es solo cosmético, la seguridad
 * real siempre va en el backend.
 */
function requireConfigAccess(req, res, next) {
  if (!req.usuario || !req.usuario.accesoConfig) {
    return res.status(403).json({
      mensaje: 'No tienes permisos para acceder a esta sección (solo Administrativo).',
    });
  }
  next();
}

/**
 * Igual que verifyToken, pero para sesiones de CLIENTE (dueños de
 * mascotas). Rechaza el token si no viene marcado como "tipo: cliente"
 * — así un token de staff no sirve para entrar a las rutas de cliente,
 * y viceversa. Deja los datos en req.propietario.
 */
async function verifyClienteToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ mensaje: 'No autenticado. Falta el token.' });
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ mensaje: 'Token inválido o expirado.' });
  }
  if (payload.tipo !== 'cliente') {
    return res.status(401).json({ mensaje: 'Este token no corresponde a una sesión de cliente.' });
  }

  // Toda sesión de cliente: la cuenta debe seguir activa (antes solo se revisaba
  // en las "recordadas", y un dueño desactivado seguía entrando hasta 8 horas).
  // Sesión "recordada" (30 días): además, la contraseña no debe haber cambiado
  // desde que se recordó el dispositivo.
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, payload.propietarioId)
      .query('SELECT ContrasenaHash, Activo FROM Propietarios WHERE PropietarioID = @id');
    const actual = r.recordset[0];
    if (!actual || !actual.Activo) {
      return res.status(401).json({ mensaje: 'Tu cuenta fue desactivada. Comunícate con la clínica.' });
    }
    if (payload.recordado && huellaContrasena(actual.ContrasenaHash) !== payload.huella) {
      return res.status(401).json({ mensaje: 'Tu sesión se cerró porque cambió tu contraseña o tu cuenta. Inicia sesión de nuevo.' });
    }
  } catch (err) {
    return res.status(503).json({ mensaje: 'No se pudo verificar tu sesión. Intenta de nuevo.' });
  }

  req.propietario = payload; // { propietarioId, nombreCompleto, recordado? }
  next();
}

/**
 * Huella corta de la contraseña guardada (del HASH, nunca de la contraseña
 * real). Va dentro de las sesiones "recordadas": si la contraseña cambia, la
 * huella ya no coincide y esas sesiones se invalidan solas.
 */
function huellaContrasena(contrasenaHash) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(contrasenaHash || '')).digest('hex').slice(0, 16);
}

/**
 * Token SOLO para que la app del cliente recoja sus recordatorios en segundo
 * plano (sin la sesión abierta). Dura meses pero únicamente sirve para
 * /api/cliente/app/notificaciones: un token de sesión no sirve aquí y este
 * token no sirve para nada más (verifyClienteToken exige tipo 'cliente').
 */
function verifyNotifAppToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ mensaje: 'No autenticado. Falta el token.' });
  }
  try {
    const payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    if (payload.tipo !== 'notif-app') {
      return res.status(401).json({ mensaje: 'Este token no es de notificaciones de la app.' });
    }
    req.propietario = { propietarioId: payload.propietarioId };
    next();
  } catch (err) {
    return res.status(401).json({ mensaje: 'Token inválido o expirado.' });
  }
}

module.exports = { verifyToken, requireConfigAccess, verifyClienteToken, verifyNotifAppToken, huellaContrasena, olvidarSesionesDe };
