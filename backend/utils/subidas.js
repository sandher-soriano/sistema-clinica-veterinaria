// utils/subidas.js
// Subida SEGURA de imágenes (fotos de pacientes, imágenes de promociones).
//
// Antes la extensión salía del nombre que mandaba el usuario y el tipo se
// validaba con el "mimetype" que declara el navegador (falsificable): se podía
// subir un .html disfrazado de imagen y quedaba publicado en /uploads, en el
// mismo dominio del panel. Ahora:
//   1. El archivo se recibe en memoria (máx. 5 MB).
//   2. Se mira su FIRMA real (primeros bytes): solo JPG, PNG, WEBP o GIF.
//   3. Se guarda con nombre aleatorio y la extensión del tipo DETECTADO.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const MAX_BYTES = 5 * 1024 * 1024;

function detectarTipo(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

/**
 * Middleware que recibe UNA imagen en el campo `campo`, la valida y la guarda
 * en `carpeta`. Deja req.file con { filename, path, size, tipo } como multer.
 * Responde 400 en JSON si algo no cuadra (sin trazas de error del servidor).
 */
function subirImagenSegura({ carpeta, prefijo, campo }) {
  fs.mkdirSync(carpeta, { recursive: true });
  const recibir = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single(campo);

  return (req, res, next) => {
    recibir(req, res, (err) => {
      if (err) {
        const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 5 MB.' : 'No se pudo recibir la imagen.';
        return res.status(400).json({ mensaje });
      }
      if (!req.file) return next(); // la ruta decide si la imagen es obligatoria

      const tipo = detectarTipo(req.file.buffer);
      if (!tipo || tipo === 'pdf') return res.status(400).json({ mensaje: 'Solo se permiten imágenes JPG, PNG, WEBP o GIF.' });

      const nombre = `${prefijo}_${crypto.randomBytes(16).toString('hex')}.${tipo}`;
      const destino = path.join(carpeta, nombre);
      fs.writeFile(destino, req.file.buffer, (e) => {
        if (e) return res.status(500).json({ mensaje: 'No se pudo guardar la imagen.' });
        req.file = { filename: nombre, path: destino, size: req.file.size, tipo, mimetype: `image/${tipo === 'jpg' ? 'jpeg' : tipo}` };
        next();
      });
    });
  };
}

module.exports = { subirImagenSegura, detectarTipo };
