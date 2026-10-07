// routes/dashboard.routes.js
const express = require('express');
const router = express.Router();
const { resumen } = require('../controllers/dashboard.controller');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);
router.get('/', resumen);

module.exports = router;
