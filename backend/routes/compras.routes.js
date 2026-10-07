// routes/compras.routes.js
// Proveedores, compras y cuentas por pagar: solo personal Administrativo.
const express = require('express');
const c = require('../controllers/compras.controller');
const p = require('../controllers/proveedores.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');

const idNumerico = (req, res, next) => (/^\d+$/.test(req.params.id) ? next() : res.status(400).json({ mensaje: 'Identificador inválido.' }));

const compras = express.Router();
compras.use(verifyToken, requireConfigAccess);
compras.get('/', c.listar);
compras.get('/pedido-sugerido', c.pedidoSugerido);
compras.get('/:id', idNumerico, c.detalle);
compras.post('/', c.crear);
compras.post('/:id/pagar', idNumerico, c.pagar);
compras.post('/:id/anular', idNumerico, c.anular);

const proveedores = express.Router();
proveedores.use(verifyToken, requireConfigAccess);
proveedores.get('/', p.listar);
proveedores.get('/ruc/:ruc', p.consultarSunat);
proveedores.post('/', p.crear);
proveedores.put('/:id', idNumerico, p.actualizar);

module.exports = { compras, proveedores };
