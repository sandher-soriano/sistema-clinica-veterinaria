// routes/esquemas.routes.js
const express = require('express');
const router = express.Router();
const { listarPorPaciente, listarTipos, crear, aplicar } = require('../controllers/esquemas.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

router.get('/tipos', listarTipos); // antes que '/' para que no choque con el query param
router.get('/', listarPorPaciente); // /api/esquemas?pacienteId=X
router.post('/', crear);
router.patch('/:id/aplicar', aplicar);

module.exports = router;
