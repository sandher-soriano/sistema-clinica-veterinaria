// routes/caja.routes.js
// Cobrar y cerrar caja: todo el personal. Anular, tarifas y resumen: solo Administrativo.
const express = require('express');
const router = express.Router();
const c = require('../controllers/caja.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');

const idNumerico = (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : res.status(400).json({ mensaje: 'Identificador inválido.' }));

router.use(verifyToken);
router.get('/', c.delDia);
router.get('/catalogo', c.catalogo);
router.get('/pendientes', c.pendientes);
router.get('/resumen', requireConfigAccess, c.resumen);
router.post('/pagos', c.cobrar);
router.post('/pagos/:id/anular', requireConfigAccess, idNumerico, c.anular);
router.post('/cierre', c.cerrar);
router.post('/cierre/reabrir', requireConfigAccess, c.reabrir);
router.put('/tarifas/:id', requireConfigAccess, idNumerico, c.actualizarTarifa);

module.exports = router;
