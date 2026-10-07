// routes/personas.routes.js
const express = require('express');
const router = express.Router();
const { listar, crear, actualizar, cambiarEstado } = require('../controllers/personas.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');

// Todo este módulo es solo para Administrativo (mismo permiso que Config/Usuarios),
// porque registrar personal contratado es una función administrativa.
router.use(verifyToken, requireConfigAccess);

router.get('/', listar);
router.post('/', crear);
router.put('/:id', actualizar);
router.patch('/:id/estado', cambiarEstado);

module.exports = router;
