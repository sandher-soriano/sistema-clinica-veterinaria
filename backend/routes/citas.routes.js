// routes/citas.routes.js
const express = require('express');
const router = express.Router();
const { listar, crear, cambiarEstado, porCerrar } = require('../controllers/citas.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

router.get('/', listar);
router.get('/por-cerrar', porCerrar); // citas que ya pasaron y falta marcar si asistió o no
router.post('/', crear);
router.patch('/:id/estado', cambiarEstado);

module.exports = router;
