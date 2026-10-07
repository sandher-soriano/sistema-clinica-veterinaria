// routes/consultas.routes.js
const express = require('express');
const router = express.Router();
const { listarPorPaciente, crear, receta } = require('../controllers/consultas.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

router.get('/', listarPorPaciente); // /api/consultas?pacienteId=X
router.get('/:id/receta', receta);
router.post('/', crear);

module.exports = router;
