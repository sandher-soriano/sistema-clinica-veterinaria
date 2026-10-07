// scripts/crear-bd.js
// Crea PremierCanDB en el SQL Server local, aplica las migraciones y crea
// el login de la app (DB_USER / DB_PASSWORD del .env).
// Se puede ejecutar más de una vez: si la BD ya existe, solo aplica migraciones.
// Uso:  node scripts/crear-bd.js
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RAIZ = path.join(__dirname, '..', '..');
const SA_FILE = path.join(process.env.LOCALAPPDATA || '', 'PremierCan', 'sa.txt');
const MIGRACIONES = [
  'migracion_promociones.sql',
  'migracion_dni_opcional.sql',
  'migracion_consulta_cita_recordatorios.sql',
  'migracion_avisos_personalizados.sql',
  'migracion_citas_asistencia.sql',
  'migracion_dni_personal_obligatorio.sql',
  'migracion_correo_propietario_opcional.sql',
  'migracion_dashboard_conteos.sql',
  'migracion_reintentos_y_totp.sql',
  'migracion_citas_respuesta_cliente.sql',
  'migracion_clinica_peso_adjuntos.sql',
  'migracion_gestion.sql',
  'migracion_caja_pos.sql',
  'migracion_proveedores_compras.sql',
  'migracion_proveedores_sunat.sql',
  'migracion_solicitudes_reposicion.sql',
  'migracion_descuento_por_item.sql',
  'migracion_mascota_por_cliente.sql',
];
const CLAVE_INICIAL = '123456';

function lotes(archivo) {
  const texto = fs.readFileSync(path.join(RAIZ, archivo), 'utf8').replace(/^﻿/, '');
  return texto.split(/^\s*GO\s*;?\s*$/im).map((b) => b.trim()).filter(Boolean);
}

async function ejecutarArchivo(pool, archivo) {
  const bs = lotes(archivo);
  for (const b of bs) await pool.request().batch(b);
  console.log(`  ✔ ${archivo} (${bs.length} lotes)`);
}

async function main() {
  const pool = await new sql.ConnectionPool({
    server: process.env.DB_SERVER || 'localhost',
    port: Number(process.env.DB_PORT) || 1433,
    user: 'sa',
    password: fs.readFileSync(SA_FILE, 'utf8').trim(),
    database: 'master',
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 1, min: 1 }, // una sola conexión: los USE se mantienen entre lotes
  }).connect();

  const db = process.env.DB_DATABASE;
  const existe = (await pool.request().query(`SELECT DB_ID('${db}') AS id`)).recordset[0].id;
  if (!existe) {
    console.log('Creando base de datos...');
    await ejecutarArchivo(pool, 'premier_can_database.sql');
  } else {
    console.log(`La base ${db} ya existe; solo se aplican migraciones.`);
  }

  console.log('Aplicando migraciones...');
  for (const m of MIGRACIONES) await ejecutarArchivo(pool, m);

  console.log(`Creando login ${process.env.DB_USER}...`);
  const r = pool.request()
    .input('u', sql.NVarChar, process.env.DB_USER)
    .input('p', sql.NVarChar, process.env.DB_PASSWORD)
    .input('db', sql.NVarChar, db);
  await r.batch(`
    DECLARE @q NVARCHAR(MAX);
    IF SUSER_ID(@u) IS NULL
      SET @q = N'CREATE LOGIN ' + QUOTENAME(@u) + N' WITH PASSWORD = ' + QUOTENAME(@p, '''') + N', CHECK_POLICY = OFF, DEFAULT_DATABASE = ' + QUOTENAME(@db);
    ELSE
      SET @q = N'ALTER LOGIN ' + QUOTENAME(@u) + N' WITH PASSWORD = ' + QUOTENAME(@p, '''');
    EXEC (@q);
    SET @q = N'USE ' + QUOTENAME(@db) + N';
      IF USER_ID(' + QUOTENAME(@u, '''') + N') IS NULL CREATE USER ' + QUOTENAME(@u) + N' FOR LOGIN ' + QUOTENAME(@u) + N';
      ALTER ROLE db_owner ADD MEMBER ' + QUOTENAME(@u) + N';';
    EXEC (@q);
  `);

  // Los usuarios de ejemplo traen un hash falso: se les pone una clave real.
  const hash = await bcrypt.hash(CLAVE_INICIAL, 12);
  const act = await pool.request().input('h', sql.NVarChar, hash).query(
    `UPDATE [${db}].dbo.Usuarios SET ContrasenaHash = @h WHERE ContrasenaHash LIKE '%REEMPLAZAR%'`
  );
  if (act.rowsAffected[0]) console.log(`  ✔ ${act.rowsAffected[0]} usuario(s) de ejemplo con clave inicial: ${CLAVE_INICIAL}`);

  await pool.close();
  console.log('Listo.');
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
