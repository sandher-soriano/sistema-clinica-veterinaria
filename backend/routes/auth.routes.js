// routes/auth.routes.js
const express = require('express');
const router = express.Router();
const {
  login, me,
  generarTotpSetup, confirmarTotpSetup, verificarTotpLogin,
  olvidePassword, restablecerPassword,
  cambiarPasswordVencida,
} = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth');
const { limites } = require('../middleware/limitador');

router.post('/login', limites.loginStaffIp, limites.loginStaff, login);
router.get('/me', verifyToken, me);

// Segundo paso del login (solo Administrativo). Límite de intentos: sin él,
// el código de 6 dígitos se podría adivinar probando sin parar.
router.post('/totp/configurar', generarTotpSetup);
router.post('/totp/confirmar', limites.totpIp, limites.totp, confirmarTotpSetup);
router.post('/totp/verificar', limites.totpIp, limites.totp, verificarTotpLogin);

// Vigencia de contraseña vencida (todos los roles)
router.post('/cambiar-password-vencida', cambiarPasswordVencida);

// Recuperar contraseña
router.post('/olvide-password', limites.olvide, olvidePassword);
router.post('/restablecer-password', limites.restablecer, restablecerPassword);

module.exports = router;