// controllers/adjuntos.controller.js
// Archivos de la mascota: análisis de laboratorio, radiografías, ecografías...
//
// - Se guardan en backend/privado/adjuntos (NO en /uploads): esa carpeta no se
//   publica, así que un archivo solo se descarga con sesión y pasando por aquí.
// - Solo PDF, JPG, PNG o WEBP (se mira la firma real del archivo), máx. 10 MB.
// - Nombre en disco aleatorio; el nombre original se guarda solo para mostrarlo.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { detectarTipo } = require('../utils/subidas');

const CARPETA = path.join(__dirname, '..', 'privado', 'adjuntos');
fs.mkdirSync(CARPETA, { recursive: true });
const MAX_BYTES = 10 * 1024 * 1024;
const PERMITIDOS = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const recibir = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single('archivo');

// POST /api/pacientes/:id/adjuntos   (multipart: archivo, descripcion?, consultaId?)
function subir(req, res) {
  recibir(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ mensaje: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo no puede pesar más de 10 MB.' : 'No se pudo recibir el archivo.' });
    }
    if (!req.file) return res.status(400).json({ mensaje: 'Elige un archivo.' });
    const tipo = detectarTipo(req.file.buffer);
    if (!PERMITIDOS[tipo]) return res.status(400).json({ mensaje: 'Solo se permiten archivos PDF, JPG, PNG o WEBP.' });

    const pacienteId = Number(req.params.id);
    const consultaId = req.body.consultaId ? Number(req.body.consultaId) : null;
    const descripcion = String(req.body.descripcion || '').trim().slice(0, 200) || null;
    // Nombre original "limpio" solo para mostrarlo (sin rutas ni caracteres raros)
    const original = path.basename(String(req.file.originalname || `archivo.${tipo}`)).replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 150);
    const enDisco = `${crypto.randomBytes(16).toString('hex')}.${tipo}`;

    try {
      const pool = await getPool();
      const p = await pool.request().input('id', sql.Int, pacienteId).query('SELECT 1 FROM Pacientes WHERE PacienteID = @id');
      if (!p.recordset.length) return res.status(404).json({ mensaje: 'Paciente no encontrado.' });
      if (consultaId) {
        const c = await pool.request().input('c', sql.Int, consultaId).input('p', sql.Int, pacienteId)
          .query('SELECT 1 FROM Consultas WHERE ConsultaID = @c AND PacienteID = @p');
        if (!c.recordset.length) return res.status(400).json({ mensaje: 'Esa consulta no es de esta mascota.' });
      }
      await fs.promises.writeFile(path.join(CARPETA, enDisco), req.file.buffer);
      const r = await pool.request()
        .input('pacienteId', sql.Int, pacienteId)
        .input('consultaId', sql.Int, consultaId)
        .input('nombre', sql.NVarChar, original)
        .input('ruta', sql.NVarChar, enDisco)
        .input('tipo', sql.NVarChar, PERMITIDOS[tipo])
        .input('descripcion', sql.NVarChar, descripcion)
        .input('tamano', sql.Int, req.file.size)
        .input('subidoPor', sql.Int, req.usuario.usuarioId)
        .query(`
          INSERT INTO ArchivosAdjuntos (PacienteID, ConsultaID, NombreArchivo, RutaArchivo, TipoArchivo, Descripcion, TamanoBytes, SubidoPor)
          OUTPUT INSERTED.ArchivoID
          VALUES (@pacienteId, @consultaId, @nombre, @ruta, @tipo, @descripcion, @tamano, @subidoPor)
        `);
      await registrarAuditoria(pool, { tabla: 'ArchivosAdjuntos', registroId: r.recordset[0].ArchivoID, accion: 'Subir', usuarioId: req.usuario.usuarioId, detalle: `Subió '${descripcion || original}' a paciente #${pacienteId}` });
      res.status(201).json({ mensaje: 'Archivo guardado.', archivoId: r.recordset[0].ArchivoID });
    } catch (e) {
      console.error(e);
      fs.promises.unlink(path.join(CARPETA, enDisco)).catch(() => {});
      res.status(500).json({ mensaje: 'No se pudo guardar el archivo.' });
    }
  });
}

const SELECT_LISTA = `
  SELECT a.ArchivoID, a.NombreArchivo, a.TipoArchivo, a.Descripcion, a.TamanoBytes, a.FechaSubida, a.ConsultaID,
         (per.Nombres + ' ' + per.Apellidos) AS SubidoPorNombre
  FROM ArchivosAdjuntos a
  LEFT JOIN Usuarios u ON u.UsuarioID = a.SubidoPor
  LEFT JOIN Personas per ON per.PersonaID = u.PersonaID`;

// GET /api/pacientes/:id/adjuntos
async function listar(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id)
      .query(`${SELECT_LISTA} WHERE a.PacienteID = @id ORDER BY a.FechaSubida DESC`);
    res.json(r.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'No se pudieron listar los archivos.' });
  }
}

// Envía el archivo (inline: se puede ver en el navegador; nosniff + nombre seguro)
async function enviarArchivo(res, fila) {
  const ruta = path.join(CARPETA, path.basename(fila.RutaArchivo));
  try { await fs.promises.access(ruta); } catch (_) { return res.status(404).json({ mensaje: 'El archivo ya no está disponible.' }); }
  res.set('Content-Type', fila.TipoArchivo || 'application/octet-stream');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fila.NombreArchivo)}`);
  res.set('Cache-Control', 'private, no-store');
  fs.createReadStream(ruta).pipe(res);
}

// GET /api/adjuntos/:id/descargar   (personal)
async function descargar(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id)
      .query('SELECT NombreArchivo, RutaArchivo, TipoArchivo FROM ArchivosAdjuntos WHERE ArchivoID = @id');
    if (!r.recordset.length) return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
    await enviarArchivo(res, r.recordset[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'No se pudo descargar el archivo.' });
  }
}

// DELETE /api/adjuntos/:id   (personal)
async function eliminar(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id)
      .query('DELETE FROM ArchivosAdjuntos OUTPUT DELETED.RutaArchivo WHERE ArchivoID = @id');
    if (!r.recordset.length) return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
    fs.promises.unlink(path.join(CARPETA, path.basename(r.recordset[0].RutaArchivo))).catch(() => {});
    await registrarAuditoria(pool, { tabla: 'ArchivosAdjuntos', registroId: Number(req.params.id), accion: 'Eliminar', usuarioId: req.usuario.usuarioId, detalle: `Eliminó el archivo #${req.params.id}` });
    res.json({ mensaje: 'Archivo eliminado.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'No se pudo eliminar el archivo.' });
  }
}

// ---- Portal de clientes: solo archivos de SUS mascotas ----
// GET /api/cliente/mascotas/:id/adjuntos
async function listarCliente(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('propietarioId', sql.Int, req.propietario.propietarioId)
      .query(`${SELECT_LISTA}
        INNER JOIN Pacientes p ON p.PacienteID = a.PacienteID
        WHERE a.PacienteID = @id AND p.PropietarioID = @propietarioId AND p.Activo = 1
        ORDER BY a.FechaSubida DESC`);
    res.json(r.recordset);
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'No se pudieron listar los archivos.' });
  }
}

// GET /api/cliente/adjuntos/:id/descargar
async function descargarCliente(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('propietarioId', sql.Int, req.propietario.propietarioId)
      .query(`SELECT a.NombreArchivo, a.RutaArchivo, a.TipoArchivo FROM ArchivosAdjuntos a
              INNER JOIN Pacientes p ON p.PacienteID = a.PacienteID
              WHERE a.ArchivoID = @id AND p.PropietarioID = @propietarioId AND p.Activo = 1`);
    if (!r.recordset.length) return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
    await enviarArchivo(res, r.recordset[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ mensaje: 'No se pudo descargar el archivo.' });
  }
}

module.exports = { subir, listar, descargar, eliminar, listarCliente, descargarCliente };
