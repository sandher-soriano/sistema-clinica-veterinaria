// config/db.js
// Maneja UN pool de conexión reutilizable hacia SQL Server (PremierCanDB).
const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT) || 1433,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    // Fijado explícito (no depender del default de la librería): al
    // guardar/leer un DATETIME2, mssql usa los campos UTC del objeto
    // Date tal cual — ni los convierte ni los reinterpreta según la
    // zona horaria del servidor. Es justo lo que necesita
    // utils/horarios.js (fechas "literales" de Perú, no instantes reales).
    useUTC: true,
  },
  pool: {
    max: 10,
    min: 1,               // mantiene siempre 1 conexión abierta — evita el
                           // "arranque en frío" al reconectar tras estar inactivo
    idleTimeoutMillis: 300000, // 5 minutos en vez de 30s antes de reciclar conexiones extra
  },
};

let poolPromise;

/**
 * Devuelve el pool de conexión (lo crea una sola vez y lo reutiliza).
 */
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .then((pool) => {
        console.log('✅ Conectado a SQL Server:', process.env.DB_DATABASE);
        return pool;
      })
      .catch((err) => {
        console.error('❌ Error al conectar a SQL Server:', err.message);
        poolPromise = null; // permite reintentar en la próxima petición
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };