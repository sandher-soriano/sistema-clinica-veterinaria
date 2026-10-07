// routes/promociones.routes.js
// Administración de promociones: SOLO Administrativo (accesoConfig).
// Las rutas públicas para clientes están en cliente.routes.js.
const express = require('express');
const path = require('path');
const router = express.Router();
const { listar, crear, actualizar, cambiarEstado, eliminar } = require('../controllers/promociones.controller');
const { verifyToken, requireConfigAccess } = require('../middleware/auth');
const { subirImagenSegura } = require('../utils/subidas');

// Imagen de la promoción: firma real validada + nombre aleatorio (utils/subidas.js).
// Los errores (tamaño/tipo) vuelven como JSON legible.
const subirImagen = subirImagenSegura({
  carpeta: path.join(__dirname, '..', 'uploads', 'promociones'),
  prefijo: 'promo',
  campo: 'imagen',
});

router.use(verifyToken, requireConfigAccess);

router.get('/', listar);
router.post('/', subirImagen, crear);
router.put('/:id', subirImagen, actualizar);
router.patch('/:id/estado', cambiarEstado);
router.delete('/:id', eliminar);

module.exports = router;
