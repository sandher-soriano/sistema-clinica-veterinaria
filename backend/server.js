// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const personasRoutes = require('./routes/personas.routes');
const pacientesRoutes = require('./routes/pacientes.routes');
const propietariosRoutes = require('./routes/propietarios.routes');
const consultasRoutes = require('./routes/consultas.routes');
const esquemasRoutes = require('./routes/esquemas.routes');
const recordatoriosRoutes = require('./routes/recordatorios.routes');
const citasRoutes = require('./routes/citas.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const reportesRoutes = require('./routes/reportes.routes');
const clienteRoutes = require('./routes/cliente.routes');
const ubigeoRoutes = require('./routes/ubigeo.routes');
const utilidadesRoutes = require('./routes/utilidades.routes');
const promocionesRoutes = require('./routes/promociones.routes');
const { getPool } = require('./config/db');
const { iniciarTareaProgramada } = require('./utils/recordatorios-auto');
const { proveedorActivo } = require('./utils/correo');

const app = express();

// ngrok entrega las visitas desde esta misma PC (127.0.0.1): confiar en el
// proxy local hace que req.ip sea la IP REAL del visitante (X-Forwarded-For).
// Sin esto el límite de intentos vería a todo internet como una sola IP.
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

// Cabeceras de seguridad (helmet). La política de contenido (CSP) permite solo
// lo que el sistema usa: Tailwind (CDN), Google Fonts y el propio servidor.
// Lo más importante: connect-src 'self' -> aunque se colara código malicioso,
// no podría mandar datos (tokens, pacientes) a otro sitio.
// 'unsafe-inline' es necesario porque las páginas tienen su JS en línea.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'http://localhost:4000'],
      connectSrc: ["'self'", 'http://localhost:4000'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,   // permite cargar fuentes/estilos de Google
  crossOriginResourcePolicy: { policy: 'same-site' },
  strictTransportSecurity: false,      // HTTPS lo maneja ngrok; en localhost no aplica
}));

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());

// Fotos de pacientes (y cualquier otro archivo subido) servidas como estáticas.
// Ej: http://localhost:4000/uploads/pacientes/paciente_5_169999.jpg
// Defensa extra: aunque algún archivo no fuera imagen, el navegador no lo
// "adivina" (nosniff) ni ejecuta nada de él (CSP con sandbox).
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  dotfiles: 'deny',
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  },
}));

// Frontend (panel administrativo/veterinario y portal de clientes),
// servido desde el mismo backend — un solo dominio en producción, sin
// tener que configurar CORS entre dos servicios separados.
// Copia tu carpeta de frontend dentro de "backend/public" antes de desplegar.
app.use(express.static(path.join(__dirname, 'public')));

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/personas', personasRoutes);
app.use('/api/pacientes', pacientesRoutes);
app.use('/api/propietarios', propietariosRoutes);
app.use('/api/consultas', consultasRoutes);
app.use('/api/esquemas', esquemasRoutes);
app.use('/api/recordatorios', recordatoriosRoutes);
app.use('/api/citas', citasRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/cliente', clienteRoutes);
app.use('/api/ubigeo', ubigeoRoutes);
app.use('/api/utilidades', utilidadesRoutes);
app.use('/api/promociones', promocionesRoutes);
app.use('/api/adjuntos', require('./routes/adjuntos.routes'));
app.use('/api/inventario', require('./routes/inventario.routes'));
app.use('/api/caja', require('./routes/caja.routes'));
app.use('/api/compras', require('./routes/compras.routes').compras);
app.use('/api/proveedores', require('./routes/compras.routes').proveedores);
{
  const { verifyToken, requireConfigAccess } = require('./middleware/auth');
  app.get('/api/auditoria', verifyToken, requireConfigAccess, require('./controllers/auditoria.controller').listar);
  app.get('/api/encuestas/resumen', verifyToken, requireConfigAccess, require('./controllers/clienteApp.controller').resumenEncuestas);
}

// Carnet de vacunación público (lo abre el QR; el enlace va firmado)
app.get('/api/publico/carnet/:token', require('./controllers/carnet.controller').datosPublicos);

// Health check (útil para probar que el server está vivo)
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Manejo de rutas no encontradas: JSON para la API, página amigable para el navegador
app.use((req, res) => {
  if (req.path.startsWith('/api') || !req.accepts('html')) {
    return res.status(404).json({ mensaje: 'Ruta no encontrada.' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Errores no controlados (JSON mal formado, etc.): mensaje genérico, sin
// mostrar rutas del disco ni detalles internos. El detalle queda en la consola.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('❌ Error no controlado:', err);
  res.status(status).json({ mensaje: status === 400 ? 'La solicitud no es válida.' : 'Ocurrió un error inesperado.' });
});

const PORT = process.env.PORT || 4000;

// Conecta a SQL Server ANTES de aceptar peticiones — así la primera pantalla
// que abra cualquier usuario (Personal, Pacientes, la que sea) no paga el
// costo de "arrancar en frío" la conexión a la base de datos.
getPool()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Backend Premier Can escuchando en http://localhost:${PORT}`);
      console.log(`📧 Correo: ${proveedorActivo() || 'sin configurar (ver CORREO_PROVEEDOR en .env)'}`);
      // Recordatorios automáticos para clientes: se generan y envían solos cada 15 min
      iniciarTareaProgramada(15);
    });
  })
  .catch((err) => {
    console.error('❌ No se pudo conectar a SQL Server al iniciar el servidor:', err.message);
    console.error('   Revisa que SQL Server esté corriendo y que los datos en .env sean correctos.');
    process.exit(1);
  });