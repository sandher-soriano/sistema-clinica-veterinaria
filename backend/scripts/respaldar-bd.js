// scripts/respaldar-bd.js
// Respaldo de la base PremierCanDB en la carpeta "respaldos" del proyecto.
//
//   node scripts/respaldar-bd.js                 -> respalda siempre
//   node scripts/respaldar-bd.js --si-hace-falta -> solo si el último tiene más de 12 h
//
// - Cada respaldo se VERIFICA (RESTORE VERIFYONLY + CHECKSUM): un respaldo que
//   no se puede leer no sirve de nada.
// - Se guardan los últimos 15; los más viejos se borran solos.
// - Lo llaman iniciar-premiercan.bat (si hace falta) y detener-premiercan.bat.
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const CARPETA = path.join(__dirname, '..', '..', 'respaldos');
const MANTENER = 15;
const HORAS_MIN = 12;
const PREFIJO = 'PremierCanDB_';

const respaldosExistentes = () => fs.readdirSync(CARPETA)
  .filter((f) => f.startsWith(PREFIJO) && f.endsWith('.bak'))
  .map((f) => ({ nombre: f, ruta: path.join(CARPETA, f), fecha: fs.statSync(path.join(CARPETA, f)).mtimeMs }))
  .sort((a, b) => b.fecha - a.fecha);

function marcaDeTiempo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  fs.mkdirSync(CARPETA, { recursive: true });

  if (process.argv.includes('--si-hace-falta')) {
    const ultimo = respaldosExistentes()[0];
    if (ultimo && Date.now() - ultimo.fecha < HORAS_MIN * 3600 * 1000) {
      console.log(`Respaldo reciente (${ultimo.nombre}); no hace falta otro.`);
      return;
    }
  }

  // Se escribe con nombre temporal y solo se renombra si pasa la verificación:
  // así un respaldo dañado nunca cuenta como "reciente".
  const archivo = path.join(CARPETA, `${PREFIJO}${marcaDeTiempo()}.bak`);
  const temporal = `${archivo}.parcial`;

  // Verificar un respaldo exige el permiso CREATE DATABASE, que el usuario de
  // la app no tiene: se usa la cuenta "sa" (contraseña guardada en el perfil
  // de Windows al instalar SQL Server). Si no existe, se usa el de la app.
  const archivoSa = path.join(process.env.LOCALAPPDATA || '', 'PremierCan', 'sa.txt');
  const credenciales = fs.existsSync(archivoSa)
    ? { user: 'sa', password: fs.readFileSync(archivoSa, 'utf8').trim() }
    : { user: process.env.DB_USER, password: process.env.DB_PASSWORD };

  const pool = await new sql.ConnectionPool({
    server: process.env.DB_SERVER || 'localhost',
    port: Number(process.env.DB_PORT) || 1433,
    ...credenciales,
    database: 'master',
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 10 * 60 * 1000,
  }).connect();

  const db = process.env.DB_DATABASE;
  console.log(`Respaldando ${db}...`);
  try {
    await pool.request().input('archivo', sql.NVarChar, temporal).batch(`
      DECLARE @sql NVARCHAR(MAX) = N'BACKUP DATABASE ' + QUOTENAME('${db.replace(/'/g, "''")}') +
        N' TO DISK = @a WITH INIT, CHECKSUM, NAME = N''Premier Can - respaldo automático''';
      EXEC sp_executesql @sql, N'@a NVARCHAR(400)', @a = @archivo;
    `);
    await pool.request().input('archivo', sql.NVarChar, temporal)
      .batch('RESTORE VERIFYONLY FROM DISK = @archivo WITH CHECKSUM');
  } catch (e) {
    try { fs.unlinkSync(temporal); } catch (_) { /* no llegó a crearse */ }
    // El mensaje útil de SQL Server suele venir en precedingErrors
    const detalle = (e.precedingErrors || []).map((x) => x.message).join(' | ');
    throw new Error(detalle ? `${detalle} | ${e.message}` : e.message);
  } finally {
    await pool.close();
  }
  fs.renameSync(temporal, archivo);

  const kb = Math.round(fs.statSync(archivo).size / 1024);
  console.log(`✔ Respaldo verificado: respaldos\\${path.basename(archivo)} (${kb} KB)`);

  // Rotación: solo los últimos MANTENER
  for (const viejo of respaldosExistentes().slice(MANTENER)) {
    try { fs.unlinkSync(viejo.ruta); console.log(`  (borrado el antiguo ${viejo.nombre})`); } catch (_) { /* si está en uso, queda para la próxima */ }
  }
}

main().catch((e) => {
  console.error('❌ No se pudo hacer el respaldo:', e.message);
  process.exit(1);
});
