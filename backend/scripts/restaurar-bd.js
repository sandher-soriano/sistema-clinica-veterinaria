// scripts/restaurar-bd.js
// Restaura un respaldo hecho con respaldar-bd.js.
//
//   node scripts/restaurar-bd.js <archivo.bak> --confirmar
//       -> REEMPLAZA la base real (antes guarda un respaldo de seguridad del estado actual)
//   node scripts/restaurar-bd.js <archivo.bak> --como NombrePrueba
//       -> lo restaura en OTRA base (para revisar un respaldo sin tocar la real)
//
// Normalmente se usa desde restaurar-respaldo.bat (elige el respaldo de una lista).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const sql = require('mssql');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const archivo = process.argv[2] && path.resolve(process.argv[2]);
const iComo = process.argv.indexOf('--como');
const destino = iComo > 0 ? process.argv[iComo + 1] : process.env.DB_DATABASE;
const esLaReal = destino === process.env.DB_DATABASE;

async function main() {
  if (!archivo || !fs.existsSync(archivo)) throw new Error('Indica un archivo .bak que exista.');
  if (!/^[A-Za-z0-9_]+$/.test(destino)) throw new Error('Nombre de base inválido.');
  if (esLaReal && !process.argv.includes('--confirmar')) {
    throw new Error('Esto REEMPLAZA la base real. Agrega --confirmar si es lo que quieres.');
  }

  // Red de seguridad: respaldo del estado actual antes de reemplazarlo
  if (esLaReal) {
    console.log('Guardando primero un respaldo del estado actual (por si te equivocaste de archivo)...');
    execFileSync(process.execPath, [path.join(__dirname, 'respaldar-bd.js')], { stdio: 'inherit' });
  }

  const sa = fs.readFileSync(path.join(process.env.LOCALAPPDATA || '', 'PremierCan', 'sa.txt'), 'utf8').trim();
  const pool = await new sql.ConnectionPool({
    server: process.env.DB_SERVER || 'localhost', port: Number(process.env.DB_PORT) || 1433,
    user: 'sa', password: sa, database: 'master',
    options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 15 * 60 * 1000,
  }).connect();

  try {
    if (esLaReal) {
      console.log(`Restaurando ${destino} desde ${path.basename(archivo)}...`);
      await pool.request().input('a', sql.NVarChar, archivo).batch(`
        IF DB_ID('${destino}') IS NOT NULL ALTER DATABASE [${destino}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        RESTORE DATABASE [${destino}] FROM DISK = @a WITH REPLACE, CHECKSUM;
        ALTER DATABASE [${destino}] SET MULTI_USER;
      `);
    } else {
      // Otra base: los archivos físicos van con otro nombre para no pisar los de la real
      const lista = (await pool.request().input('a', sql.NVarChar, archivo).query('RESTORE FILELISTONLY FROM DISK = @a')).recordset;
      const ruta = (await pool.request().query("SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS NVARCHAR(400)) AS r")).recordset[0].r;
      const req = pool.request().input('a', sql.NVarChar, archivo);
      const moves = lista.map((f, i) => {
        req.input(`l${i}`, sql.NVarChar, f.LogicalName);
        req.input(`f${i}`, sql.NVarChar, path.join(ruta, `${destino}_${i}${f.Type === 'L' ? '.ldf' : '.mdf'}`));
        return `MOVE @l${i} TO @f${i}`;
      });
      console.log(`Restaurando como base aparte "${destino}"...`);
      await req.batch(`RESTORE DATABASE [${destino}] FROM DISK = @a WITH REPLACE, CHECKSUM, ${moves.join(', ')}`);
    }
  } finally {
    await pool.close();
  }
  console.log(`✔ Restauración completa en ${destino}.`);
}

main().catch((e) => {
  const detalle = (e.precedingErrors || []).map((x) => x.message).join(' | ');
  console.error('❌ No se pudo restaurar:', detalle ? `${detalle} | ${e.message}` : e.message);
  process.exit(1);
});
