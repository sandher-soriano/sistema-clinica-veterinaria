// routes/adjuntos.routes.js
// Descargar / eliminar archivos de mascotas (análisis, radiografías). Solo personal.
const express = require('express');
const router = express.Router();
const { descargar, eliminar } = require('../controllers/adjuntos.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.use('/:id', (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : res.status(400).json({ mensaje: 'Archivo inválido.' })));

router.get('/:id/descargar', descargar);
router.delete('/:id', eliminar);

module.exports = router;
