// routes/recordatorios.routes.js
const express = require('express');
const router = express.Router();
const {
  listar, resumen, crear, cambiarEstado, listarReglas, actualizarRegla, generarAutomaticos,
  alcance, crearAviso, enviarAhoraRecordatorio,
} = require('../controllers/recordatorios.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');

router.use(verifyToken);

router.get('/', listar);
router.get('/resumen', resumen);
router.post('/', crear);
router.patch('/:id/estado', cambiarEstado);
router.get('/reglas', listarReglas);
// Las reglas son globales (afectan a todos los clientes): solo Administrativo
router.put('/reglas/:id', requireConfigAccess, actualizarRegla);
router.post('/generar-automaticos', generarAutomaticos);

// Avisos personalizados ("Nueva notificación") y envío inmediato
router.get('/avisos/alcance', alcance);
router.post('/avisos', crearAviso);
router.post('/:id/enviar-ahora', enviarAhoraRecordatorio);

module.exports = router;
