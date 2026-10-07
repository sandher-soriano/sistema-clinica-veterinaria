// controllers/promociones.controller.js
// Promociones de la clínica.
//  - Panel (solo Administrativo): listar, crear, editar, activar/desactivar y eliminar.
//  - Portal / app de clientes (público, sin sesión): ver las vigentes y las próximas,
//    que la app usa también para programar las notificaciones del celular.
//
// Fechas: FechaInicio / FechaFin son DATE "literales de Perú" (igual criterio que
// utils/horarios.js). "Hoy" se calcula en SQL con la hora de Lima (UTC-5, sin
// horario de verano), así no depende de la zona horaria de la máquina.
const fs = require('fs');
const path = require('path');
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');

const HOY_LIMA = "CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '-05:00') AS DATE)";

// Columnas comunes (fechas como texto 'YYYY-MM-DD' para no pelear con zonas horarias)
const COLUMNAS = `
  p.PromocionID, p.Titulo, p.Etiqueta, p.Categoria, p.Descripcion, p.Condiciones,
  p.PrecioRegular, p.PrecioPromocion, p.DescuentoTipo, p.DescuentoValor,
  CONVERT(VARCHAR(10), p.FechaInicio, 23) AS FechaInicio,
  CONVERT(VARCHAR(10), p.FechaFin, 23) AS FechaFin,
  p.ImagenURL, p.Activo,
  CASE
    WHEN p.Activo = 0 THEN 'Inactiva'
    WHEN ${HOY_LIMA} < p.FechaInicio THEN 'Programada'
    WHEN ${HOY_LIMA} > p.FechaFin THEN 'Finalizada'
    ELSE 'Vigente'
  END AS Estado`;

const CATEGORIAS = ['Consultas', 'Vacunas', 'Desparasitación', 'Baño y grooming', 'Cirugía', 'Laboratorio', 'Tienda', 'Otro'];

function textoOpcional(valor, max) {
  const t = (valor ?? '').toString().trim();
  return t ? t.slice(0, max) : null;
}

function numeroOpcional(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') return null;
  const n = Number(`${valor}`.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t || '') && !Number.isNaN(Date.parse(`${t}T00:00:00Z`));

/**
 * Valida el body (multipart: todo llega como texto). Devuelve { datos } o { error }.
 */
function validar(body) {
  const titulo = textoOpcional(body.titulo, 120);
  const descripcion = textoOpcional(body.descripcion, 2000);
  const fechaInicio = (body.fechaInicio || '').trim();
  const fechaFin = (body.fechaFin || '').trim();
  const precioRegular = numeroOpcional(body.precioRegular);
  const precioPromocion = numeroOpcional(body.precioPromocion);
  const categoria = textoOpcional(body.categoria, 40);

  if (!titulo) return { error: 'El nombre de la promoción es obligatorio.' };
  if (!descripcion) return { error: 'La descripción es obligatoria.' };
  if (!esFecha(fechaInicio) || !esFecha(fechaFin)) return { error: 'Indica una fecha de inicio y de fin válidas.' };
  if (fechaFin < fechaInicio) return { error: 'La fecha de fin no puede ser anterior a la de inicio.' };
  if (Number.isNaN(precioRegular) || Number.isNaN(precioPromocion)) return { error: 'Los precios deben ser números.' };
  if ((precioRegular !== null && precioRegular < 0) || (precioPromocion !== null && precioPromocion < 0)) {
    return { error: 'Los precios no pueden ser negativos.' };
  }
  if (precioRegular !== null && precioPromocion !== null && precioPromocion > precioRegular) {
    return { error: 'El precio de promoción no puede ser mayor que el precio regular.' };
  }
  if (categoria && !CATEGORIAS.includes(categoria)) return { error: 'Categoría no válida.' };

  // Descuento automático en Caja (opcional): porcentaje 1-100 o monto fijo > 0
  const descuentoTipo = ['Porcentaje', 'Monto'].includes(body.descuentoTipo) ? body.descuentoTipo : null;
  const descuentoValor = descuentoTipo ? numeroOpcional(body.descuentoValor) : null;
  if (descuentoTipo && (descuentoValor === null || Number.isNaN(descuentoValor) || descuentoValor <= 0)) {
    return { error: 'Indica el valor del descuento en caja.' };
  }
  if (descuentoTipo === 'Porcentaje' && descuentoValor > 100) return { error: 'El descuento en caja no puede ser mayor al 100%.' };

  return {
    datos: {
      titulo,
      descripcion,
      fechaInicio,
      fechaFin,
      precioRegular,
      precioPromocion,
      categoria,
      descuentoTipo,
      descuentoValor,
      etiqueta: textoOpcional(body.etiqueta, 30),
      condiciones: textoOpcional(body.condiciones, 1000),
      activo: body.activo === undefined ? true : ['true', '1', 'on', true].includes(body.activo),
    },
  };
}

function borrarImagen(imagenUrl) {
  if (!imagenUrl || !imagenUrl.startsWith('/uploads/promociones/')) return;
  const ruta = path.join(__dirname, '..', imagenUrl);
  fs.unlink(ruta, () => {}); // si ya no existe, no pasa nada
}

function cargarParametros(request, d) {
  return request
    .input('titulo', sql.NVarChar(120), d.titulo)
    .input('etiqueta', sql.NVarChar(30), d.etiqueta)
    .input('categoria', sql.NVarChar(40), d.categoria)
    .input('descripcion', sql.NVarChar(2000), d.descripcion)
    .input('condiciones', sql.NVarChar(1000), d.condiciones)
    .input('precioRegular', sql.Decimal(10, 2), d.precioRegular)
    .input('precioPromocion', sql.Decimal(10, 2), d.precioPromocion)
    .input('descuentoTipo', sql.NVarChar(10), d.descuentoTipo)
    .input('descuentoValor', sql.Decimal(10, 2), d.descuentoValor)
    .input('fechaInicio', sql.VarChar(10), d.fechaInicio)
    .input('fechaFin', sql.VarChar(10), d.fechaFin)
    .input('activo', sql.Bit, d.activo);
}

// ============================================================
// Panel administrativo
// ============================================================

// GET /api/promociones
async function listar(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ${COLUMNAS},
             CONCAT(pe.Nombres, ' ', pe.Apellidos) AS CreadoPorNombre,
             p.FechaCreacion
      FROM Promociones p
      LEFT JOIN Usuarios u ON u.UsuarioID = p.CreadoPor
      LEFT JOIN Personas pe ON pe.PersonaID = u.PersonaID
      ORDER BY
        CASE WHEN p.Activo = 1 AND ${HOY_LIMA} BETWEEN p.FechaInicio AND p.FechaFin THEN 0
             WHEN p.Activo = 1 AND ${HOY_LIMA} < p.FechaInicio THEN 1
             ELSE 2 END,
        p.FechaInicio DESC, p.PromocionID DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al listar promociones:', err);
    res.status(500).json({ mensaje: 'No se pudieron cargar las promociones.' });
  }
}

// POST /api/promociones  (multipart, campo de imagen: "imagen")
async function crear(req, res) {
  const { datos, error } = validar(req.body);
  if (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ mensaje: error });
  }
  try {
    const pool = await getPool();
    const imagenUrl = req.file ? `/uploads/promociones/${req.file.filename}` : null;
    const result = await cargarParametros(pool.request(), datos)
      .input('imagenUrl', sql.NVarChar(300), imagenUrl)
      .input('creadoPor', sql.Int, req.usuario.usuarioId)
      .query(`
        INSERT INTO Promociones
          (Titulo, Etiqueta, Categoria, Descripcion, Condiciones, PrecioRegular, PrecioPromocion,
           DescuentoTipo, DescuentoValor, FechaInicio, FechaFin, ImagenURL, Activo, CreadoPor)
        OUTPUT INSERTED.PromocionID
        VALUES
          (@titulo, @etiqueta, @categoria, @descripcion, @condiciones, @precioRegular, @precioPromocion,
           @descuentoTipo, @descuentoValor, @fechaInicio, @fechaFin, @imagenUrl, @activo, @creadoPor)
      `);
    const id = result.recordset[0].PromocionID;
    await registrarAuditoria(pool, {
      tabla: 'Promociones', registroId: id, accion: 'Crear', usuarioId: req.usuario.usuarioId,
      detalle: `Creó la promoción "${datos.titulo}" (${datos.fechaInicio} al ${datos.fechaFin}).`,
    });
    res.status(201).json({ mensaje: 'Promoción publicada.', promocionId: id });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('Error al crear promoción:', err);
    res.status(500).json({ mensaje: 'No se pudo guardar la promoción.' });
  }
}

// PUT /api/promociones/:id  (multipart; "quitarImagen=true" para dejarla sin imagen)
async function actualizar(req, res) {
  const id = Number(req.params.id);
  const { datos, error } = validar(req.body);
  if (error) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ mensaje: error });
  }
  try {
    const pool = await getPool();
    const actual = await pool.request().input('id', sql.Int, id)
      .query('SELECT ImagenURL FROM Promociones WHERE PromocionID = @id');
    if (!actual.recordset.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ mensaje: 'La promoción no existe.' });
    }
    const imagenAnterior = actual.recordset[0].ImagenURL;
    let imagenUrl = imagenAnterior;
    if (req.file) imagenUrl = `/uploads/promociones/${req.file.filename}`;
    else if (req.body.quitarImagen === 'true') imagenUrl = null;

    await cargarParametros(pool.request(), datos)
      .input('id', sql.Int, id)
      .input('imagenUrl', sql.NVarChar(300), imagenUrl)
      .query(`
        UPDATE Promociones SET
          Titulo = @titulo, Etiqueta = @etiqueta, Categoria = @categoria, Descripcion = @descripcion,
          Condiciones = @condiciones, PrecioRegular = @precioRegular, PrecioPromocion = @precioPromocion,
          DescuentoTipo = @descuentoTipo, DescuentoValor = @descuentoValor,
          FechaInicio = @fechaInicio, FechaFin = @fechaFin, ImagenURL = @imagenUrl, Activo = @activo,
          FechaActualizacion = SYSDATETIME()
        WHERE PromocionID = @id
      `);
    if (imagenAnterior && imagenAnterior !== imagenUrl) borrarImagen(imagenAnterior);

    await registrarAuditoria(pool, {
      tabla: 'Promociones', registroId: id, accion: 'Actualizar', usuarioId: req.usuario.usuarioId,
      detalle: `Editó la promoción "${datos.titulo}".`,
    });
    res.json({ mensaje: 'Promoción actualizada.' });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('Error al actualizar promoción:', err);
    res.status(500).json({ mensaje: 'No se pudo actualizar la promoción.' });
  }
}

// PATCH /api/promociones/:id/estado  { activo: true|false }
async function cambiarEstado(req, res) {
  const id = Number(req.params.id);
  const activo = !!req.body.activo;
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('activo', sql.Bit, activo)
      .query(`
        UPDATE Promociones SET Activo = @activo, FechaActualizacion = SYSDATETIME()
        OUTPUT INSERTED.Titulo
        WHERE PromocionID = @id
      `);
    if (!result.recordset.length) return res.status(404).json({ mensaje: 'La promoción no existe.' });
    await registrarAuditoria(pool, {
      tabla: 'Promociones', registroId: id, accion: activo ? 'Activar' : 'Desactivar', usuarioId: req.usuario.usuarioId,
      detalle: `${activo ? 'Activó' : 'Pausó'} la promoción "${result.recordset[0].Titulo}".`,
    });
    res.json({ mensaje: activo ? 'Promoción activada.' : 'Promoción pausada.' });
  } catch (err) {
    console.error('Error al cambiar estado de promoción:', err);
    res.status(500).json({ mensaje: 'No se pudo cambiar el estado.' });
  }
}

// DELETE /api/promociones/:id
async function eliminar(req, res) {
  const id = Number(req.params.id);
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id)
      .query('DELETE FROM Promociones OUTPUT DELETED.Titulo, DELETED.ImagenURL WHERE PromocionID = @id');
    if (!result.recordset.length) return res.status(404).json({ mensaje: 'La promoción no existe.' });
    const { Titulo, ImagenURL } = result.recordset[0];
    borrarImagen(ImagenURL);
    // La tabla Auditoria solo admite Crear/Actualizar/Activar/Desactivar: lo dejamos como "Desactivar".
    await registrarAuditoria(pool, {
      tabla: 'Promociones', registroId: id, accion: 'Desactivar', usuarioId: req.usuario.usuarioId,
      detalle: `Eliminó la promoción "${Titulo}".`,
    });
    res.json({ mensaje: 'Promoción eliminada.' });
  } catch (err) {
    console.error('Error al eliminar promoción:', err);
    res.status(500).json({ mensaje: 'No se pudo eliminar la promoción.' });
  }
}

// ============================================================
// Portal / app de clientes (público)
// ============================================================

// GET /api/cliente/promociones  -> vigentes + próximas (hasta 60 días)
async function listarPublicas(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT ${COLUMNAS}
      FROM Promociones p
      WHERE p.Activo = 1
        AND p.FechaFin >= ${HOY_LIMA}
        AND p.FechaInicio <= DATEADD(DAY, 60, ${HOY_LIMA})
      ORDER BY CASE WHEN p.FechaInicio <= ${HOY_LIMA} THEN 0 ELSE 1 END, p.FechaFin ASC, p.PromocionID DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al listar promociones públicas:', err);
    res.status(500).json({ mensaje: 'No se pudieron cargar las promociones.' });
  }
}

// GET /api/cliente/promociones/:id
async function obtenerPublica(req, res) {
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, Number(req.params.id)).query(`
      SELECT ${COLUMNAS}
      FROM Promociones p
      WHERE p.PromocionID = @id AND p.Activo = 1 AND p.FechaFin >= ${HOY_LIMA}
    `);
    if (!result.recordset.length) return res.status(404).json({ mensaje: 'Esta promoción ya no está disponible.' });
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Error al obtener promoción:', err);
    res.status(500).json({ mensaje: 'No se pudo cargar la promoción.' });
  }
}

module.exports = { listar, crear, actualizar, cambiarEstado, eliminar, listarPublicas, obtenerPublica, CATEGORIAS };
