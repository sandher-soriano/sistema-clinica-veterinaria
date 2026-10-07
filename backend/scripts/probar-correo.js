// Envía un correo de prueba con el proveedor configurado en .env
// Uso: npm run probar-correo -- destino@correo.com
require('dotenv').config();
const { enviarCorreo, plantillaCorreo, proveedorActivo } = require('../utils/correo');

const destino = process.argv[2];
if (!destino) {
  console.log('Uso: npm run probar-correo -- destino@correo.com');
  process.exit(1);
}

(async () => {
  console.log('Proveedor configurado:', proveedorActivo() || 'ninguno');
  const r = await enviarCorreo({
    para: destino,
    asunto: 'Prueba de correo — Premier Can',
    html: plantillaCorreo({ titulo: '¡Funciona! 🎉', contenido: '<p>Si lees esto, los correos de Premier Can ya están llegando.</p>' }),
  });
  console.log(r.enviado ? `✅ Correo enviado a ${destino}` : `❌ No se envió: ${r.motivo}`);
  process.exit(r.enviado ? 0 : 1);
})();
