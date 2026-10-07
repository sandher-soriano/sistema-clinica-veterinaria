// routes/propietarios.routes.js
const express = require('express');
const router = express.Router();
const { buscar, generarAcceso, validarDni } = require('../controllers/propietarios.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');

// Cualquier usuario logueado (Administrativo o Veterinario) puede buscar
// propietarios al registrar un paciente.
router.use(verifyToken);

router.get('/', buscar);
router.get('/validar-dni/:dni', validarDni);

// Dar acceso al portal de clientes: solo Administrativo (como Config/Usuarios)
router.post('/:id/generar-acceso', requireConfigAccess, generarAcceso);

module.exports = router;