// routes/cliente.routes.js
const express = require('express');
const router = express.Router();
const { login, me, olvidePassword, restablecerPassword, cambiarPasswordInicial } = require('../controllers/clienteAuth.controller');
const { misMascotas, registrarMascota, fotoMascota, detalleMascota, historialMascota, esquemasMascota, misCitas, solicitarCita, confirmarMiCita, cancelarMiCita, recetaCliente, responderEncuesta } = require('../controllers/clienteApp.controller');
const { listarPublicas, obtenerPublica } = require('../controllers/promociones.controller');
const { verifyClienteToken, verifyNotifAppToken } = require('../middleware/auth');
const { limites } = require('../middleware/limitador');
const { enlaceCliente } = require('../controllers/carnet.controller');
const adjuntos = require('../controllers/adjuntos.controller');
const { tokenNotificacionesApp, notificacionesApp, confirmarNotificacionesApp, misAvisos } = require('../controllers/notificacionesApp.controller');

// --- Login (no requiere sesión todavía) ---
router.post('/auth/login', limites.loginClienteIp, limites.loginCliente, login);
router.post('/auth/olvide-password', limites.olvide, olvidePassword);
router.post('/auth/restablecer-password', limites.restablecer, restablecerPassword);
router.get('/auth/me', verifyClienteToken, me);
router.post('/auth/cambiar-password-inicial', verifyClienteToken, cambiarPasswordInicial);

// --- Promociones: públicas (la app las consulta incluso sin sesión para notificar) ---
router.get('/promociones', listarPublicas);
router.get('/promociones/:id', obtenerPublica);

// --- Recordatorios para la app (notificaciones en segundo plano) ---
// La app pide un token de notificaciones con su sesión, y luego lo usa en segundo plano.
router.post('/app/token-notificaciones', verifyClienteToken, tokenNotificacionesApp);
router.get('/app/notificaciones', verifyNotifAppToken, notificacionesApp);
router.post('/app/notificaciones/confirmar', verifyNotifAppToken, confirmarNotificacionesApp);

// --- El resto SÍ requiere estar logueado como cliente ---
router.get('/mascotas', verifyClienteToken, misMascotas);
router.post('/mascotas', verifyClienteToken, registrarMascota);
// Foto: se valida sesión e id ANTES de recibir el archivo; la propiedad se verifica al guardar
const subirFotoCliente = require('../utils/subidas').subirImagenSegura({
  carpeta: require('path').join(__dirname, '..', 'uploads', 'pacientes'), prefijo: 'paciente', campo: 'foto',
});
router.post('/mascotas/:id/foto', verifyClienteToken,
  (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : res.status(400).json({ mensaje: 'Mascota inválida.' })),
  subirFotoCliente, fotoMascota);
router.get('/mascotas/:id', verifyClienteToken, detalleMascota);
router.get('/mascotas/:id/historial', verifyClienteToken, historialMascota);
router.get('/mascotas/:id/esquemas', verifyClienteToken, esquemasMascota);
router.get('/mascotas/:id/carnet-enlace', verifyClienteToken, enlaceCliente);
router.get('/consultas/:id/receta', verifyClienteToken, recetaCliente);
router.get('/mascotas/:id/adjuntos', verifyClienteToken, adjuntos.listarCliente);
router.get('/adjuntos/:id/descargar', verifyClienteToken, adjuntos.descargarCliente);
router.get('/citas', verifyClienteToken, misCitas);
router.get('/avisos', verifyClienteToken, misAvisos);
router.post('/citas', verifyClienteToken, solicitarCita);
router.post('/citas/:id/confirmar', verifyClienteToken, confirmarMiCita);
router.post('/citas/:id/cancelar', verifyClienteToken, cancelarMiCita);
router.post('/citas/:id/encuesta', verifyClienteToken, responderEncuesta);

module.exports = router;
