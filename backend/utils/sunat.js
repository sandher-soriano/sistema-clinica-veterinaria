// utils/sunat.js
// Consulta de RUC en el padrón de SUNAT a través de la API gratuita de apis.net.pe
// (no requiere token; si se configura RUC_API_TOKEN en .env se envía para tener
// más consultas por día). Se consulta desde el servidor: el navegador nunca llama
// a terceros (la política de seguridad solo permite conectarse al propio sistema).
// Resultados en memoria 24 h para no repetir consultas.
const { rucValido } = require('./ruc');

const URLS = [
  (r) => `https://api.apis.net.pe/v2/sunat/ruc?numero=${r}`,
  (r) => `https://api.apis.net.pe/v1/ruc?numero=${r}`,
];
const CACHE_MS = 24 * 3600 * 1000;
const cache = new Map(); // ruc -> { datos, en }

function normalizar(j, ruc) {
  const razon = (j.razonSocial || j.nombre || '').trim();
  if (!razon) return null;
  const limpio = (v) => (v && v !== '-' ? String(v).trim() : '');
  const direccion = [limpio(j.direccion), limpio(j.distrito), limpio(j.provincia), limpio(j.departamento)].filter(Boolean).join(', ');
  return {
    ruc,
    razonSocial: razon,
    estado: limpio(j.estado) || null,         // ACTIVO, BAJA DE OFICIO, SUSPENSION TEMPORAL…
    condicion: limpio(j.condicion) || null,   // HABIDO, NO HABIDO…
    direccion: direccion || null,
    ubigeo: limpio(j.ubigeo) || null,
  };
}

/** Devuelve { datos } o { error, status } (status 404 = no existe en SUNAT). */
async function consultarRuc(ruc) {
  const r = String(ruc || '').trim();
  if (!rucValido(r)) return { error: 'RUC no válido.', status: 400 };
  const c = cache.get(r);
  if (c && Date.now() - c.en < CACHE_MS) return { datos: c.datos };
  const headers = { Accept: 'application/json' };
  if (process.env.RUC_API_TOKEN) headers.Authorization = `Bearer ${process.env.RUC_API_TOKEN}`;
  let ultimo = 'No se pudo consultar SUNAT.';
  for (const url of URLS) {
    try {
      const resp = await fetch(url(r), { headers, signal: AbortSignal.timeout(8000) });
      if (resp.status === 404 || resp.status === 422) return { error: 'Ese RUC no figura en el padrón de SUNAT.', status: 404 };
      if (!resp.ok) { ultimo = `El servicio de consulta respondió ${resp.status}.`; continue; }
      const datos = normalizar(await resp.json(), r);
      if (!datos) return { error: 'Ese RUC no figura en el padrón de SUNAT.', status: 404 };
      cache.set(r, { datos, en: Date.now() });
      return { datos };
    } catch (err) {
      ultimo = err.name === 'TimeoutError' ? 'El servicio de consulta tardó demasiado.' : 'Sin conexión con el servicio de consulta.';
    }
  }
  return { error: `${ultimo} Puedes llenar los datos a mano.`, status: 503 };
}

/** Último resultado conocido (sin llamar a la API). */
const enCache = (ruc) => { const c = cache.get(String(ruc || '')); return c && Date.now() - c.en < CACHE_MS ? c.datos : null; };

module.exports = { consultarRuc, enCache };
