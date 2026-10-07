// controllers/proveedores.controller.js
// Proveedores del inventario (laboratorios, distribuidoras, droguerías).
// El RUC es opcional (hay proveedores informales), pero si se escribe debe ser
// válido según SUNAT y no repetirse.
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { rucValido } = require('../utils/ruc');
const { consultarRuc, enCache } = require('../utils/sunat');

// Límite sencillo de consultas a SUNAT por usuario (la API gratuita tiene cupo diario)
const consultasRecientes = new Map(); // usuarioId -> [marcas de tiempo]
function puedeConsultar(usuarioId) {
  const ahora = Date.now();
  const lista = (consultasRecientes.get(usuarioId) || []).filter((t) => ahora - t < 60000);
  if (lista.length >= 20) return false;
  lista.push(ahora); consultasRecientes.set(usuarioId, lista);
  return true;
}

// GET /api/proveedores/ruc/:ruc — datos del padrón de SUNAT (razón social, dirección, estado)
async function consultarSunat(req, res) {
  const ruc = String(req.params.ruc || '').trim();
  if (!rucValido(ruc)) return res.status(400).json({ mensaje: 'El RUC no es válido (revisa los 11 dígitos).' });
  if (!puedeConsultar(req.usuario.usuarioId)) return res.status(429).json({ mensaje: 'Demasiadas consultas seguidas: espera un minuto.' });
  const r = await consultarRuc(ruc);
  if (r.error) return res.status(r.status).json({ mensaje: r.error });
  try {
    const pool = await getPool();
    const ya = (await pool.request().input('ruc', sql.Char(11), ruc).query('SELECT ProveedorID, RazonSocial FROM Proveedores WHERE RUC = @ruc')).recordset[0];
    res.json({ ...r.datos, yaRegistrado: ya ? { proveedorId: ya.ProveedorID, razonSocial: ya.RazonSocial } : null });
  } catch (err) {
    console.error(err);
    res.json({ ...r.datos, yaRegistrado: null });
  }
}

// Guarda el estado SUNAT conocido para ese RUC (de la última consulta), sin llamar a la API al guardar
async function guardarEstadoSunat(pool, id, ruc) {
  const datos = ruc ? enCache(ruc) : null;
  if (ruc && !datos) return; // sin consulta reciente: se conserva lo que había
  await pool.request().input('id', sql.Int, id)
    .input('e', sql.NVarChar(40), datos ? datos.estado : null).input('c', sql.NVarChar(40), datos ? datos.condicion : null)
    .query(`UPDATE Proveedores SET EstadoSunat = @e, CondicionSunat = @c,
              VerificadoSunat = CASE WHEN @e IS NULL THEN NULL ELSE DATEADD(HOUR, -5, SYSUTCDATETIME()) END
            WHERE ProveedorID = @id`);
}

const TIPOS = ['Laboratorio', 'Distribuidora', 'Droguería', 'Otro'];
const texto = (v, max) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };

// GET /api/proveedores — con lo comprado este año y la deuda pendiente
async function listar(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT p.*,
             (SELECT COUNT(*) FROM Medicamentos m WHERE m.ProveedorID = p.ProveedorID AND m.Activo = 1) AS Productos,
             ISNULL(c.ComprasAnio, 0) AS ComprasAnio, ISNULL(c.TotalAnio, 0) AS TotalAnio,
             ISNULL(c.Deuda, 0) AS Deuda, ISNULL(c.DeudaVencida, 0) AS DeudaVencida, c.UltimaCompra
      FROM Proveedores p
      OUTER APPLY (
        SELECT SUM(CASE WHEN YEAR(FechaEmision) = YEAR(DATEADD(HOUR, -5, SYSUTCDATETIME())) THEN 1 ELSE 0 END) AS ComprasAnio,
               SUM(CASE WHEN YEAR(FechaEmision) = YEAR(DATEADD(HOUR, -5, SYSUTCDATETIME())) THEN Total ELSE 0 END) AS TotalAnio,
               SUM(CASE WHEN EstadoPago = 'Pendiente' THEN Total ELSE 0 END) AS Deuda,
               SUM(CASE WHEN EstadoPago = 'Pendiente' AND FechaVencimientoPago < CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE) THEN Total ELSE 0 END) AS DeudaVencida,
               MAX(FechaEmision) AS UltimaCompra
        FROM Compras WHERE ProveedorID = p.ProveedorID AND Anulada = 0) c
      ORDER BY p.Activo DESC, p.RazonSocial`);
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron cargar los proveedores.' });
  }
}

function validar(b) {
  const d = {
    ruc: texto(b.ruc, 11), razonSocial: texto(b.razonSocial, 150), nombreComercial: texto(b.nombreComercial, 100),
    tipo: b.tipo || 'Distribuidora', contacto: texto(b.contacto, 100), telefono: texto(b.telefono, 20),
    correo: texto(b.correo, 120), direccion: texto(b.direccion, 200),
    condicionPago: b.condicionPago === 'Crédito' ? 'Crédito' : 'Contado', diasCredito: Number(b.diasCredito || 0),
    diasEntrega: texto(b.diasEntrega, 60), notas: texto(b.notas, 500), activo: b.activo !== false,
  };
  if (!d.razonSocial) return { error: 'La razón social (o nombre) del proveedor es obligatoria.' };
  if (d.ruc && !rucValido(d.ruc)) return { error: 'El RUC no es válido: debe tener 11 dígitos, empezar con 10, 15, 17 o 20, y su dígito de control debe cuadrar.' };
  if (!TIPOS.includes(d.tipo)) return { error: 'Tipo de proveedor inválido.' };
  if (d.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo)) return { error: 'El correo no es válido.' };
  if (d.telefono && !/^[\d\s+()-]{6,20}$/.test(d.telefono)) return { error: 'El teléfono no es válido.' };
  if (d.condicionPago === 'Crédito' && !(Number.isInteger(d.diasCredito) && d.diasCredito >= 1 && d.diasCredito <= 180)) return { error: 'Indica los días de crédito (1 a 180).' };
  if (d.condicionPago === 'Contado') d.diasCredito = 0;
  return { d };
}

function parametros(r, d) {
  return r.input('ruc', sql.Char(11), d.ruc).input('rs', sql.NVarChar(150), d.razonSocial).input('nc', sql.NVarChar(100), d.nombreComercial)
    .input('tipo', sql.NVarChar(20), d.tipo).input('contacto', sql.NVarChar(100), d.contacto).input('tel', sql.NVarChar(20), d.telefono)
    .input('correo', sql.NVarChar(120), d.correo).input('dir', sql.NVarChar(200), d.direccion).input('cond', sql.NVarChar(10), d.condicionPago)
    .input('dias', sql.Int, d.diasCredito).input('entrega', sql.NVarChar(60), d.diasEntrega).input('notas', sql.NVarChar(500), d.notas).input('activo', sql.Bit, d.activo);
}
const esDuplicado = (err) => err.number === 2601 || err.number === 2627;

// POST /api/proveedores
async function crear(req, res) {
  const { d, error } = validar(req.body || {});
  if (error) return res.status(400).json({ mensaje: error });
  try {
    const pool = await getPool();
    const r = await parametros(pool.request(), d).query(`
      INSERT INTO Proveedores (RUC, RazonSocial, NombreComercial, Tipo, Contacto, Telefono, Correo, Direccion, CondicionPago, DiasCredito, DiasEntrega, Notas, Activo)
      OUTPUT INSERTED.ProveedorID
      VALUES (@ruc, @rs, @nc, @tipo, @contacto, @tel, @correo, @dir, @cond, @dias, @entrega, @notas, @activo)`);
    const id = r.recordset[0].ProveedorID;
    await guardarEstadoSunat(pool, id, d.ruc);
    await registrarAuditoria(pool, { tabla: 'Proveedores', registroId: id, accion: 'Crear', usuarioId: req.usuario.usuarioId, detalle: `Registró al proveedor ${d.razonSocial}${d.ruc ? ` (RUC ${d.ruc})` : ''}` });
    res.status(201).json({ mensaje: 'Proveedor registrado.', proveedorId: id });
  } catch (err) {
    if (esDuplicado(err)) return res.status(409).json({ mensaje: 'Ya hay un proveedor con ese RUC.' });
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo registrar el proveedor.' });
  }
}

// PUT /api/proveedores/:id
async function actualizar(req, res) {
  const { d, error } = validar(req.body || {});
  if (error) return res.status(400).json({ mensaje: error });
  try {
    const pool = await getPool();
    const r = await parametros(pool.request(), d).input('id', sql.Int, req.params.id).query(`
      UPDATE Proveedores SET RUC = @ruc, RazonSocial = @rs, NombreComercial = @nc, Tipo = @tipo, Contacto = @contacto, Telefono = @tel,
        Correo = @correo, Direccion = @dir, CondicionPago = @cond, DiasCredito = @dias, DiasEntrega = @entrega, Notas = @notas, Activo = @activo
      WHERE ProveedorID = @id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ mensaje: 'Proveedor no encontrado.' });
    await guardarEstadoSunat(pool, Number(req.params.id), d.ruc);
    await registrarAuditoria(pool, { tabla: 'Proveedores', registroId: Number(req.params.id), accion: d.activo ? 'Actualizar' : 'Desactivar', usuarioId: req.usuario.usuarioId, detalle: `${d.activo ? 'Editó' : 'Desactivó'} al proveedor ${d.razonSocial}` });
    res.json({ mensaje: 'Proveedor actualizado.' });
  } catch (err) {
    if (esDuplicado(err)) return res.status(409).json({ mensaje: 'Ya hay un proveedor con ese RUC.' });
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo actualizar el proveedor.' });
  }
}

module.exports = { listar, crear, actualizar, consultarSunat, TIPOS };
