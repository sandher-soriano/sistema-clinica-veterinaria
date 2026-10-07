// middleware/limitador.js
// Límite de intentos FALLIDOS para login, verificación en 2 pasos y
// recuperación de contraseña (evita adivinar contraseñas o códigos de 6
// dígitos probando sin parar). Sin librerías: contadores en memoria.
//
//  - Solo cuentan las respuestas con error (4xx, salvo el propio 429).
//  - Un intento correcto (2xx) borra el contador de esa cuenta.
//  - Si una clave llega al máximo, responde 429 hasta que pase la ventana.
//
// Las claves combinan la IP con la cuenta (usuario/correo), así un atacante
// no puede bloquear a todo el mundo y tampoco probar sin límite contra una cuenta.
const jwt = require('jsonwebtoken');

const contadores = new Map(); // clave -> { fallos, expira }

function ipDe(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida';
}

function minutosRestantes(expira) {
  return Math.max(1, Math.ceil((expira - Date.now()) / 60000));
}

/**
 * @param {object} opciones
 * @param {string} opciones.nombre        prefijo de las claves (ej. 'login-staff')
 * @param {number} opciones.max           fallos permitidos dentro de la ventana
 * @param {number} opciones.ventanaMin    duración de la ventana / bloqueo, en minutos
 * @param {(req)=>string[]} opciones.claves   claves a contar (además de nombre)
 * @param {boolean} [opciones.contarTodo] contar también los intentos correctos (p. ej. "olvidé mi contraseña")
 */
function limitarIntentos({ nombre, max, ventanaMin, claves, contarTodo = false }) {
  const ventanaMs = ventanaMin * 60 * 1000;
  return (req, res, next) => {
    const lista = claves(req).filter(Boolean).map((k) => `${nombre}|${String(k).toLowerCase()}`);
    const ahora = Date.now();

    for (const clave of lista) {
      const c = contadores.get(clave);
      if (c && c.expira > ahora && c.fallos >= max) {
        res.set('Retry-After', String(Math.ceil((c.expira - ahora) / 1000)));
        return res.status(429).json({
          mensaje: `Demasiados intentos. Por seguridad espera ${minutosRestantes(c.expira)} minuto(s) e inténtalo de nuevo.`,
        });
      }
    }

    res.on('finish', () => {
      const fallo = res.statusCode >= 400 && res.statusCode !== 429;
      const exito = res.statusCode >= 200 && res.statusCode < 300;
      for (const clave of lista) {
        if (fallo || contarTodo) {
          const c = contadores.get(clave);
          if (!c || c.expira <= Date.now()) contadores.set(clave, { fallos: 1, expira: Date.now() + ventanaMs });
          else c.fallos += 1;
        } else if (exito) {
          contadores.delete(clave);
        }
      }
    });
    next();
  };
}

// Limpieza periódica de contadores vencidos (no crece la memoria)
setInterval(() => {
  const ahora = Date.now();
  for (const [k, c] of contadores) if (c.expira <= ahora) contadores.delete(k);
}, 10 * 60 * 1000).unref();

// Usuario dueño de un token temporal del login (sin verificar firma: solo
// sirve para agrupar intentos; la verificación real la hace el controlador).
function usuarioDelTokenTemporal(req) {
  const t = req.body && req.body.tokenTemporal;
  const p = t ? jwt.decode(t) : null;
  return p && p.usuarioId ? `usuario:${p.usuarioId}` : null;
}

const cuerpo = (campo) => (req) => (req.body && typeof req.body[campo] === 'string' ? req.body[campo].trim() : '');

// ---- Reglas ya armadas ----
const limites = {
  // Personal: 5 contraseñas malas por cuenta+IP; 20 por IP (contra probar muchas cuentas)
  loginStaff: limitarIntentos({ nombre: 'login-staff', max: 5, ventanaMin: 15, claves: (req) => [`${ipDe(req)}|${cuerpo('usuario')(req)}`] }),
  loginStaffIp: limitarIntentos({ nombre: 'login-staff-ip', max: 20, ventanaMin: 15, claves: (req) => [ipDe(req)] }),
  // Código de 6 dígitos: 5 fallos por cuenta (en total, cualquier IP) y 10 por IP
  totp: limitarIntentos({ nombre: 'totp', max: 5, ventanaMin: 15, claves: (req) => [usuarioDelTokenTemporal(req)] }),
  totpIp: limitarIntentos({ nombre: 'totp-ip', max: 10, ventanaMin: 15, claves: (req) => [ipDe(req)] }),
  // Clientes
  loginCliente: limitarIntentos({ nombre: 'login-cliente', max: 5, ventanaMin: 15, claves: (req) => [`${ipDe(req)}|${cuerpo('correo')(req)}`] }),
  loginClienteIp: limitarIntentos({ nombre: 'login-cliente-ip', max: 20, ventanaMin: 15, claves: (req) => [ipDe(req)] }),
  // Recuperar contraseña: cada pedido cuenta (envía correos)
  olvide: limitarIntentos({ nombre: 'olvide', max: 5, ventanaMin: 60, contarTodo: true, claves: (req) => [ipDe(req)] }),
  restablecer: limitarIntentos({ nombre: 'restablecer', max: 10, ventanaMin: 15, claves: (req) => [ipDe(req)] }),
};

module.exports = { limitarIntentos, limites };
