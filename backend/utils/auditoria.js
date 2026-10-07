// utils/auditoria.js
// Inserta una fila en la tabla Auditoria. Se usa desde cualquier
// controlador que necesite dejar registrado QUIÉN hizo QUÉ y CUÁNDO
// (por ejemplo: quién registró o editó un paciente).
//
// No lanza el error hacia arriba si falla: registrar auditoría nunca
// debe tumbar la operación principal (crear/editar el paciente sí debe
// quedar guardado aunque, por algún motivo raro, la auditoría falle).
const { sql } = require('../config/db');

/**
 * @param {object} pool - pool de conexión (el mismo que usa el controlador)
 * @param {object} datos
 * @param {string} datos.tabla - ej. 'Pacientes'
 * @param {number} datos.registroId - PK del registro afectado
 * @param {'Crear'|'Actualizar'|'Activar'|'Desactivar'} datos.accion
 * @param {number} datos.usuarioId - quién lo hizo (req.usuario.usuarioId)
 * @param {string} [datos.detalle] - descripción breve, ej. "Registró paciente Kaiser"
 */
async function registrarAuditoria(pool, { tabla, registroId, accion, usuarioId, detalle }) {
  try {
    await pool.request()
      .input('tabla', sql.NVarChar, tabla)
      .input('registroId', sql.Int, registroId)
      .input('accion', sql.NVarChar, accion)
      .input('usuarioId', sql.Int, usuarioId)
      .input('detalle', sql.NVarChar, detalle || null)
      .query(`
        INSERT INTO Auditoria (TablaAfectada, RegistroID, Accion, UsuarioID, Detalle)
        VALUES (@tabla, @registroId, @accion, @usuarioId, @detalle)
      `);
  } catch (err) {
    console.error('No se pudo registrar la auditoría (no afecta la operación principal):', err.message);
  }
}

module.exports = { registrarAuditoria };
