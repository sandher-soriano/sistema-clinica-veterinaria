// routes/usuarios.routes.js
const express = require('express');
const router = express.Router();
const { listar, crear, cambiarEstado, listarVeterinarios, listarHorarios } = require('../controllers/usuarios.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');

// Ruta liviana: cualquier usuario logueado (sin requireConfigAccess) puede
// pedir la lista de veterinarios, para el formulario de "Registrar consulta".
router.get('/veterinarios/lista', verifyToken, listarVeterinarios);

// Todas las rutas de abajo requieren: token válido + rol con AccesoConfig = 1
router.use(verifyToken, requireConfigAccess);

router.get('/', listar);
router.post('/', crear);
router.get('/:id/horarios', listarHorarios);
router.patch('/:id/estado', cambiarEstado);

module.exports = router;