// routes/inventario.routes.js
// Ver y mover stock: todo el personal. Crear/editar productos y lotes: solo Administrativo.
const express = require('express');
const router = express.Router();
const c = require('../controllers/inventario.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');

const idNumerico = (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : res.status(400).json({ mensaje: 'Identificador inválido.' }));

router.use(verifyToken);

router.get('/', c.listar);
router.get('/alertas', c.alertas);
router.post('/', requireConfigAccess, c.crear);
router.get('/solicitudes', c.listarSolicitudes);
router.post('/solicitudes', c.solicitar);
router.post('/solicitudes/:id/resolver', idNumerico, c.resolverSolicitud);
router.put('/lotes/:id', requireConfigAccess, idNumerico, c.editarLote);
router.post('/lotes/:id/baja', requireConfigAccess, idNumerico, c.bajaLote);
router.put('/:id', requireConfigAccess, idNumerico, c.actualizar);
router.post('/:id/movimiento', idNumerico, c.movimiento);
router.get('/:id/movimientos', idNumerico, c.movimientos);
router.get('/:id/lotes', idNumerico, c.lotes);

module.exports = router;
