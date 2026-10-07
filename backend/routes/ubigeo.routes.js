// routes/ubigeo.routes.js
const express = require('express');
const router = express.Router();
const { listarDepartamentos, listarProvincias, listarDistritos } = require('../controllers/ubigeo.controller');
const { verifyToken } = require('../middleware/auth');

// Cualquier usuario logueado puede consultar el catálogo (se usa al
// registrar Personas o Propietarios).
router.use(verifyToken);

router.get('/departamentos', listarDepartamentos);
router.get('/provincias/:codigoDepartamento', listarProvincias);
router.get('/distritos/:codigoProvincia', listarDistritos);

module.exports = router;
