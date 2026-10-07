// routes/utilidades.routes.js
const express = require('express');
const router = express.Router();
const { validarCorreo } = require('../controllers/utilidades.controller');
const { verifyToken } = require('../middleware/auth');

// Cualquier usuario logueado puede usar estas validaciones (se llaman
// desde varios formularios: Personas, Propietarios, etc.).
router.use(verifyToken);

router.get('/validar-correo/:correo', validarCorreo);

module.exports = router;
