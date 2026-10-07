// scripts/cargar-proveedores-peru.js
// Carga proveedores reales del mercado veterinario peruano (laboratorios que más
// importan vacunas al país y distribuidoras conocidas).
//  - Cada RUC se verifica en SUNAT (API gratuita) y se guardan la razón social,
//    dirección fiscal y estado oficiales. Si SUNAT no responde, ese proveedor se
//    omite (vuelve a ejecutar el script más tarde).
// No se cargan condiciones de pago ni vendedores: dependen de lo que acuerde la clínica.
// Idempotente: si el proveedor ya existe (por RUC o nombre comercial), no se duplica.
// Uso:  node scripts/cargar-proveedores-peru.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sql, getPool } = require('../config/db');
const { consultarRuc } = require('../utils/sunat');

const PROVEEDORES = [
  { ruc: '20548112509', nombreComercial: 'Zoetis', tipo: 'Laboratorio',
    notas: 'Laboratorio de salud animal: vacunas (Vanguard), antiparasitarios (Simparica, Revolution) y dermatología (Apoquel).' },
  { ruc: '20501900487', nombreComercial: 'Hipra', tipo: 'Laboratorio',
    notas: 'Laboratorio especializado en vacunas veterinarias.' },
  { ruc: '20372399687', nombreComercial: 'MSD Salud Animal', tipo: 'Laboratorio',
    notas: 'Vacunas (Nobivac) y antiparasitarios (Bravecto). Antes Intervet S.A.' },
  { ruc: '20505434804', nombreComercial: 'Ceva Salud Animal', tipo: 'Laboratorio',
    notas: 'Vacunas y productos para mascotas.' },
  { ruc: '20523163320', nombreComercial: 'Boehringer Ingelheim', tipo: 'Laboratorio', telefono: '(01) 212 4132',
    notas: 'Antiparasitarios (NexGard, Frontline) y vacunas. Teléfono de su oficina corporativa.' },
  { ruc: '20515799258', nombreComercial: 'TotalVet', tipo: 'Distribuidora', telefono: '945 159 084',
    notas: 'Distribuidor exclusivo de VetPlus en Perú.' },
  { ruc: '20511169331', nombreComercial: 'Veter Perú', tipo: 'Distribuidora',
    notas: 'Distribuidora nacional de productos veterinarios.' },
];

async function main() {
  const pool = await getPool();
  for (const p of PROVEEDORES) {
    const ya = (await pool.request().input('ruc', sql.Char(11), p.ruc || null).input('nc', sql.NVarChar(100), p.nombreComercial)
      .query('SELECT ProveedorID FROM Proveedores WHERE (@ruc IS NOT NULL AND RUC = @ruc) OR NombreComercial = @nc')).recordset[0];
    if (ya) { console.log(`  · ${p.nombreComercial}: ya estaba registrado`); continue; }
    let d = { ...p, estado: null, condicion: null };
    if (p.ruc) {
      const r = await consultarRuc(p.ruc);
      if (r.error) { console.log(`  ✘ ${p.nombreComercial}: no se pudo verificar en SUNAT (${r.error}); se omite`); continue; }
      d = { ...d, razonSocial: r.datos.razonSocial, direccion: r.datos.direccion, estado: r.datos.estado, condicion: r.datos.condicion };
    }
    await pool.request()
      .input('ruc', sql.Char(11), d.ruc || null).input('rs', sql.NVarChar(150), d.razonSocial).input('nc', sql.NVarChar(100), d.nombreComercial)
      .input('tipo', sql.NVarChar(20), d.tipo).input('tel', sql.NVarChar(20), d.telefono || null).input('dir', sql.NVarChar(200), d.direccion || null)
      .input('notas', sql.NVarChar(500), d.notas).input('e', sql.NVarChar(40), d.estado).input('c', sql.NVarChar(40), d.condicion)
      .query(`INSERT INTO Proveedores (RUC, RazonSocial, NombreComercial, Tipo, Telefono, Direccion, Notas, EstadoSunat, CondicionSunat, VerificadoSunat)
              VALUES (@ruc, @rs, @nc, @tipo, @tel, @dir, @notas, @e, @c, CASE WHEN @e IS NULL THEN NULL ELSE DATEADD(HOUR, -5, SYSUTCDATETIME()) END)`);
    console.log(`  ✔ ${d.nombreComercial}${d.ruc ? ` — ${d.razonSocial} (RUC ${d.ruc}, SUNAT: ${d.estado}/${d.condicion})` : ' — RUC pendiente'}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
