// utils/emailValidator.js
// Verifica que el DOMINIO de un correo tenga servidor de correo real
// detrás (registros MX), tal como pidió el ingeniero: "hay APIs que te
// permiten saber si el servidor que estás colocando está activo".
//
// No usamos ninguna API externa de pago: el módulo "dns" de Node.js
// hace exactamente esa consulta directo contra los servidores DNS
// públicos — es gratis, no necesita token, y es lo mismo que hacen por
// dentro las APIs de pago (Abstract API, mailboxlayer, etc.).
//
// Importante: esto NO confirma que la casilla específica exista (eso
// requeriría mandar un correo real y que lo confirmen — otra técnica
// distinta). Esto confirma que el DOMINIO puede recibir correo, que es
// justo lo que describió el ingeniero: filtra los "@asdasd123.com" que
// nunca podrían recibir nada, sin depender de un tercero.
const dns = require('dns');

/**
 * @param {string} correo
 * @returns {Promise<{valido: boolean|null, mensaje?: string}>}
 *          valido=true  -> el dominio tiene servidor de correo real
 *          valido=false -> el dominio NO existe o no recibe correo
 *          valido=null  -> no se pudo verificar (ej. sin internet el
 *                           servidor); no se debe bloquear el registro
 *                           por un problema de infraestructura, no del dato
 */
async function verificarDominioCorreo(correo) {
  const dominio = String(correo || '').split('@')[1]?.toLowerCase().trim();

  if (!dominio || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(dominio)) {
    return { valido: false, mensaje: 'El correo no tiene un formato válido.' };
  }

  // 1) Intento normal: registros MX (lo que usa cualquier servidor de correo real)
  try {
    const registrosMx = await dns.promises.resolveMx(dominio);
    if (registrosMx && registrosMx.length > 0) {
      return { valido: true };
    }
  } catch (err) {
    if (err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
      // Error de red/DNS del propio servidor, no del dominio en sí —
      // no bloqueamos el registro por un problema de infraestructura.
      console.error('Error de red al verificar MX:', err.code || err.message);
      return { valido: null, mensaje: 'No se pudo verificar el correo en este momento (sin conexión del servidor). Se guardará sin validar.' };
    }
  }

  // 2) Respaldo: si no hay MX, algunos dominios igual reciben correo por
  // su registro A/AAAA directo (regla implícita del protocolo SMTP).
  try {
    const direcciones = await dns.promises.resolve(dominio);
    if (direcciones && direcciones.length > 0) {
      return { valido: true };
    }
  } catch (err) {
    // Tampoco tiene registro A -> el dominio realmente no existe o no recibe nada.
  }

  return { valido: false, mensaje: `El dominio "${dominio}" no tiene un servidor de correo activo.` };
}

module.exports = { verificarDominioCorreo };
