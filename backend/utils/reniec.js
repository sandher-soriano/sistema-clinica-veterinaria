// utils/reniec.js
// Valida un DNI peruano contra una API pública de RENIEC.
//
// Soporta dos proveedores, elegido con RENIEC_PROVIDER en tu .env:
//   RENIEC_PROVIDER=decolecta   (recomendado — ver https://decolecta.com)
//   RENIEC_PROVIDER=apisnet     (https://apis.net.pe — puede estar sin
//                                 tokens nuevos disponibles actualmente)
//
// IMPORTANTE sobre Decolecta: no tuve forma de confirmar en vivo el
// formato EXACTO de su endpoint (no encontré su documentación oficial
// desde aquí). Dejé la implementación con el patrón más común
// (Authorization: Bearer <token>, GET /v1/reniec/dni?numero=DNI). Si al
// probarlo el error es distinto a 401/404 (ej. 404 en la URL misma, o
// un formato de respuesta distinto), entra a tu panel de Decolecta,
// copia el ejemplo de código que te dan ahí (curl o JS) y pégamelo — lo
// ajusto en un minuto.
//
// Si dejas RENIEC_API_TOKEN vacío, el sistema sigue funcionando en modo
// desarrollo: no consulta RENIEC de verdad, solo revisa el formato (8
// dígitos) y avisa que no fue validado — igual que hace utils/correo.js
// cuando no hay Mailgun configurado.

const RENIEC_PROVIDER = (process.env.RENIEC_PROVIDER || 'decolecta').toLowerCase();
const RENIEC_API_TOKEN = process.env.RENIEC_API_TOKEN || '';

const PROVEEDORES = {
  decolecta: {
    url: process.env.RENIEC_API_URL || 'https://api.decolecta.com/v1/reniec/dni',
    construirPeticion: (dni) => ({
      url: `${PROVEEDORES.decolecta.url}?numero=${encodeURIComponent(dni)}`,
      headers: { Authorization: `Bearer ${RENIEC_API_TOKEN}` },
    }),
    // Ajusta estos nombres de campo si la respuesta real de Decolecta es distinta.
    extraerDatos: (data) => (data && data.first_name
      ? { nombres: data.first_name, apellidos: `${data.first_last_name || ''} ${data.second_last_name || ''}`.trim() }
      : (data && data.nombres ? { nombres: data.nombres, apellidos: `${data.apellidoPaterno || ''} ${data.apellidoMaterno || ''}`.trim() } : null)),
  },
  apisnet: {
    url: process.env.RENIEC_API_URL || 'https://api.apis.net.pe/v2/reniec/dni',
    construirPeticion: (dni) => ({
      url: `${PROVEEDORES.apisnet.url}?numero=${encodeURIComponent(dni)}`,
      // apis.net.pe NO usa "Bearer" — espera el token directo.
      headers: { Authorization: RENIEC_API_TOKEN },
    }),
    extraerDatos: (data) => (data && data.nombres
      ? { nombres: data.nombres, apellidos: `${data.apellidoPaterno || ''} ${data.apellidoMaterno || ''}`.trim() }
      : null),
  },
};

/**
 * Consulta un DNI. Requiere Node 18+ (usa el fetch global).
 * @param {string} dni - 8 dígitos
 * @returns {Promise<{valido:boolean, nombres?:string, apellidos?:string, modoDesarrollo?:boolean, mensaje?:string}>}
 */
async function consultarDni(dni) {
  if (!/^\d{8}$/.test(String(dni || ''))) {
    return { valido: false, mensaje: 'El DNI debe tener 8 dígitos numéricos.' };
  }

  if (!RENIEC_API_TOKEN) {
    console.log('⚠️  [MODO DESARROLLO] RENIEC_API_TOKEN vacío — no se valida contra RENIEC de verdad, solo se revisó el formato.');
    return {
      valido: false,
      modoDesarrollo: true,
      mensaje: 'Validación real desactivada (falta configurar RENIEC_API_TOKEN en el backend). El DNI se guardará sin validar contra RENIEC.',
    };
  }

  const proveedor = PROVEEDORES[RENIEC_PROVIDER] || PROVEEDORES.decolecta;
  const { url, headers } = proveedor.construirPeticion(dni);

  try {
    const resp = await fetch(url, { headers });

    if (resp.status === 401 || resp.status === 403) {
      return {
        valido: false,
        mensaje: `El token de ${RENIEC_PROVIDER} no fue aceptado (código ${resp.status}). Revisa que lo copiaste completo en RENIEC_API_TOKEN y que la cuenta esté activa.`,
      };
    }
    if (resp.status === 404) {
      return { valido: false, mensaje: 'Ese DNI no existe según RENIEC (o la URL del proveedor cambió — avísame si esto sale con cualquier DNI).' };
    }
    if (!resp.ok) {
      console.error(`RENIEC (${RENIEC_PROVIDER}) respondió con error:`, resp.status);
      return { valido: false, mensaje: `No se pudo consultar RENIEC en este momento (código ${resp.status}).` };
    }

    const data = await resp.json();
    const datos = proveedor.extraerDatos(data);

    if (!datos) {
      console.error(`Respuesta inesperada de ${RENIEC_PROVIDER}:`, JSON.stringify(data));
      return { valido: false, mensaje: 'Ese DNI no existe, o el proveedor cambió el formato de respuesta (revisa la consola del backend).' };
    }

    return { valido: true, ...datos };
  } catch (err) {
    console.error('Error consultando RENIEC:', err.message);
    return { valido: false, mensaje: 'No se pudo conectar con el servicio de RENIEC. Revisa tu conexión.' };
  }
}

module.exports = { consultarDni };