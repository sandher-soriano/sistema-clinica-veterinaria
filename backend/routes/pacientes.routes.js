// routes/pacientes.routes.js
const express = require('express');
const path = require('path');
const router = express.Router();
const { listar, obtener, crear, actualizar, cambiarEstado, obtenerAuditoria, subirFoto } = require('../controllers/pacientes.controller');
const { verifyToken } = require('../middleware/auth');
const { subirImagenSegura } = require('../utils/subidas');
const { enlaceStaff } = require('../controllers/carnet.controller');
const adjuntos = require('../controllers/adjuntos.controller');

// Fotos de las mascotas: se valida la firma real del archivo y se guardan con
// nombre aleatorio (ver utils/subidas.js).
const subirFotoPaciente = subirImagenSegura({
  carpeta: path.join(__dirname, '..', 'uploads', 'pacientes'),
  prefijo: 'paciente',
  campo: 'foto',
});

// El :id debe ser un número ANTES de recibir el archivo
function idNumerico(req, res, next) {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ mensaje: 'Paciente inválido.' });
  next();
}

// Pacientes es visible para Administrativo Y Veterinario (no requiere accesoConfig)
router.use(verifyToken);

router.get('/', listar);
router.get('/:id', obtener);
router.post('/', crear);
router.put('/:id', actualizar);
router.patch('/:id/estado', cambiarEstado);
router.get('/:id/auditoria', obtenerAuditoria);
router.post('/:id/foto', idNumerico, subirFotoPaciente, subirFoto);
router.get('/:id/carnet-enlace', idNumerico, enlaceStaff);
router.get('/:id/adjuntos', idNumerico, adjuntos.listar);
router.post('/:id/adjuntos', idNumerico, adjuntos.subir);

module.exports = router;
