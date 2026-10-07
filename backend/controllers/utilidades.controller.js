// controllers/utilidades.controller.js
// Endpoints de validación genéricos, reutilizables desde cualquier
// formulario (Personas, Propietarios, etc.) — no pertenecen a un solo módulo.
const { verificarDominioCorreo } = require('../utils/emailValidator');

// GET /api/utilidades/validar-correo/:correo
// Se llama ANTES de guardar, cuando el usuario termina de escribir el
// correo. Solo confirma que el dominio pueda recibir correo — no
// confirma que esa casilla específica exista (eso necesitaría mandar un
// correo real y que lo confirmen).
async function validarCorreo(req, res) {
  try {
    const { correo } = req.params;
    const resultado = await verificarDominioCorreo(correo);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ valido: null, mensaje: 'Error al validar el correo.' });
  }
}

module.exports = { validarCorreo };
