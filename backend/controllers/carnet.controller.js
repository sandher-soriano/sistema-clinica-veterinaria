// controllers/carnet.controller.js
// Carnet de vacunación digital con QR de verificación.
//
// El carnet vive en una página pública (public/carnet.html?t=TOKEN) que se puede
// imprimir / guardar como PDF. El QR apunta a esa misma página: una peluquería,
// hotel de mascotas o control de viaje lo escanea y VE que las vacunas están al día.
//
// TOKEN = "<pacienteId>.<firma>": la firma (HMAC con JWT_SECRET) impide inventar
// o cambiar el número para ver carnets de otras mascotas.
// Solo se muestra lo necesario: datos de la mascota y sus vacunas/desparasitaciones
// (del dueño, solo el nombre de pila y la inicial del apellido).
const crypto = require('crypto');
const QRCode = require('qrcode');
const { sql, getPool } = require('../config/db');
const { actualizarEstadosEsquemas } = require('../utils/estadoEsquemas');

function firma(pacienteId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`carnet:${pacienteId}`).digest('base64url').slice(0, 22);
}
const tokenDe = (pacienteId) => `${pacienteId}.${firma(pacienteId)}`;

function pacienteDelToken(token) {
  const m = /^(\d+)\.([A-Za-z0-9_-]{22})$/.exec(String(token || ''));
  if (!m) return null;
  const esperada = Buffer.from(firma(m[1]));
  const recibida = Buffer.from(m[2]);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida) ? Number(m[1]) : null;
}

// Dirección pública del carnet (la del túnel ngrok si está configurada)
function urlCarnet(req, pacienteId) {
  const base = (process.env.FRONTEND_ORIGIN || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/carnet.html?t=${tokenDe(pacienteId)}`;
}

// GET /api/pacientes/:id/carnet-enlace (personal)
async function enlaceStaff(req, res) {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ mensaje: 'Paciente inválido.' });
  res.json({ url: urlCarnet(req, Number(req.params.id)) });
}

// GET /api/cliente/mascotas/:id/carnet-enlace (solo mascotas del propio cliente)
async function enlaceCliente(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('propietarioId', sql.Int, req.propietario.propietarioId)
      .query('SELECT PacienteID FROM Pacientes WHERE PacienteID = @id AND PropietarioID = @propietarioId AND Activo = 1');
    if (!r.recordset.length) return res.status(404).json({ mensaje: 'Mascota no encontrada.' });
    res.json({ url: urlCarnet(req, r.recordset[0].PacienteID) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo generar el carnet.' });
  }
}

// GET /api/publico/carnet/:token (sin sesión: es lo que abre el QR)
async function datosPublicos(req, res) {
  const pacienteId = pacienteDelToken(req.params.token);
  if (!pacienteId) return res.status(404).json({ mensaje: 'Este carnet no es válido.' });
  try {
    const pool = await getPool();
    const p = (await pool.request().input('id', sql.Int, pacienteId).query(`
      SELECT p.Nombre, p.Especie, p.Raza, p.Sexo, p.FechaNacimiento, p.FotoURL,
             pr.Nombres AS DuenoNombres, pr.Apellidos AS DuenoApellidos
      FROM Pacientes p INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
      WHERE p.PacienteID = @id AND p.Activo = 1
    `)).recordset[0];
    if (!p) return res.status(404).json({ mensaje: 'Este carnet ya no está vigente.' });

    await actualizarEstadosEsquemas(pool);
    const esquemas = (await pool.request().input('id', sql.Int, pacienteId).query(`
      SELECT t.NombreTipo AS Tipo, e.NombreProducto AS Producto, e.FechaAplicacion, e.FechaProximaDosis, e.Estado
      FROM EsquemasPreventivos e INNER JOIN TiposEsquemaPreventivo t ON t.TipoEsquemaID = e.TipoEsquemaID
      WHERE e.PacienteID = @id
      ORDER BY t.NombreTipo DESC, COALESCE(e.FechaAplicacion, e.FechaProximaDosis) DESC
    `)).recordset;

    const aplicadas = esquemas.filter((e) => e.FechaAplicacion);
    const pendientes = esquemas.filter((e) => !e.FechaAplicacion);
    const vencidas = pendientes.filter((e) => e.Estado === 'Atrasado');
    const estadoGeneral = !aplicadas.length ? 'SinRegistros' : vencidas.length ? 'Vencido' : 'AlDia';

    const inicialApellido = (p.DuenoApellidos || '').trim().charAt(0);
    const url = urlCarnet(req, pacienteId);
    res.json({
      mascota: {
        nombre: p.Nombre, especie: p.Especie, raza: p.Raza, sexo: p.Sexo,
        fechaNacimiento: p.FechaNacimiento, fotoUrl: p.FotoURL,
        dueno: `${(p.DuenoNombres || '').trim().split(/\s+/)[0]}${inicialApellido ? ` ${inicialApellido}.` : ''}`,
      },
      aplicadas,
      proximas: pendientes,
      estadoGeneral,
      emitido: new Date().toISOString(),
      url,
      qr: await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#00505a', light: '#ffffff' } }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar el carnet.' });
  }
}

module.exports = { enlaceStaff, enlaceCliente, datosPublicos, pacienteDelToken };
