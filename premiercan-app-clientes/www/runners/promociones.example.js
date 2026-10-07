// www/runners/promociones.js
// Se ejecuta en SEGUNDO PLANO con @capacitor/background-runner (sin navegador ni DOM),
// aproximadamente cada 15 minutos aunque la app esté cerrada (Android decide el
// momento exacto según la batería). También lo dispara la app al abrirse.
//
// Revisa y avisa con una notificación:
//   - promociones: una vigente que el celular todavía no había anunciado, y el
//     último día de cada una ("¡Último día!")
//   - recordatorios del cliente con sesión iniciada: vacunas, desparasitación
//     y citas ("Mañana: cita de Rocky a las 09:00")
// Lo ya anunciado se guarda en CapacitorKV (promociones) o se confirma al
// servidor (recordatorios) para no repetir notificaciones.

// Copia este archivo como promociones.js y pon aquí la dirección pública del sistema
const SERVIDOR = 'https://TU-DOMINIO.ngrok-free.dev';
const OFFSET_ULTIMO_DIA = 1000000; // id de notificación "último día" = 1000000 + PromocionID
const MAX_POR_REVISION = 3;        // evita una ráfaga de avisos la primera vez

function leerLista(clave) {
  try {
    const guardado = CapacitorKV.get(clave);
    return JSON.parse((guardado && guardado.value) || '[]');
  } catch (e) {
    return [];
  }
}

function guardarLista(clave, lista) {
  CapacitorKV.set(clave, JSON.stringify(lista));
}

// "Hoy" en Perú (UTC-5, sin horario de verano) como 'YYYY-MM-DD'
function hoyLima() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

function precio(valor) {
  if (valor === null || valor === undefined) return '';
  const n = Number(valor);
  return Number.isFinite(n) ? `S/ ${n % 1 ? n.toFixed(2) : n}` : '';
}

function textoCuerpo(p) {
  const partes = [];
  if (p.Etiqueta) partes.push(p.Etiqueta);
  if (p.PrecioPromocion !== null && p.PrecioPromocion !== undefined) partes.push(`ahora ${precio(p.PrecioPromocion)}`);
  const resumen = (p.Descripcion || '').replace(/\s+/g, ' ').slice(0, 90);
  return partes.length ? `${partes.join(' · ')} — ${resumen}` : resumen;
}

async function revisar() {
  const respuesta = await fetch(`${SERVIDOR}/api/cliente/promociones`, {
    method: 'GET',
    headers: { 'User-Agent': 'PremierCanApp/1.0', 'ngrok-skip-browser-warning': '1', Accept: 'application/json' },
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const promociones = JSON.parse(await respuesta.text());

  const hoy = hoyLima();
  const anunciadas = leerLista('promosAnunciadas');
  const ultimoDia = leerLista('promosUltimoDia');
  const vigentes = promociones.filter((p) => p.Estado === 'Vigente');
  const avisos = [];

  vigentes.forEach((p) => {
    const esUltimoDia = p.FechaFin === hoy;
    if (!anunciadas.includes(p.PromocionID)) {
      avisos.push({
        id: p.PromocionID,
        title: esUltimoDia ? `⏰ ¡Solo hoy! ${p.Titulo}` : `🎉 ${p.Titulo}`,
        body: textoCuerpo(p),
      });
      anunciadas.push(p.PromocionID);
      if (esUltimoDia) ultimoDia.push(p.PromocionID);
    } else if (esUltimoDia && !ultimoDia.includes(p.PromocionID)) {
      avisos.push({
        id: OFFSET_ULTIMO_DIA + p.PromocionID,
        title: `⏰ Último día: ${p.Titulo}`,
        body: 'Hoy termina esta promoción. ¡Aprovéchala! 🐾',
      });
      ultimoDia.push(p.PromocionID);
    }
  });

  const aEnviar = avisos.slice(0, MAX_POR_REVISION).map((a) => ({
    ...a,
    actionTypeId: 'promo',
    smallIcon: 'ic_stat_promo',
    autoCancel: true,
    largeBody: a.body,
  }));
  if (aEnviar.length) CapacitorNotifications.schedule(aEnviar);

  // Solo recordamos promociones que siguen publicadas (si se pausa y se reactiva, se vuelve a avisar)
  const idsActuales = promociones.map((p) => p.PromocionID);
  guardarLista('promosAnunciadas', anunciadas.filter((id) => idsActuales.includes(id)));
  guardarLista('promosUltimoDia', ultimoDia.filter((id) => idsActuales.includes(id)));

  return { revisadas: promociones.length, notificadas: aEnviar.length };
}

// ------------------------------------------------------------------
// Recordatorios del cliente (vacunas, desparasitación, citas)
// Usa el token de notificaciones que la app le entregó al iniciar sesión
// (evento 'guardarCliente'); ese token SOLO sirve para esto.
// ids de notificación: 3000000 + PacienteID (vacuna/desparasitación -> abre la mascota)
//                      4000000 + PacienteID (cita -> abre "Mis citas")
//                      5000000 + id (aviso personalizado -> abre "Mis avisos"). Ver MainActivity.
// ------------------------------------------------------------------
const OFFSET_PREVENTIVO = 3000000;
const OFFSET_CITA = 4000000;

async function revisarRecordatorios() {
  const guardado = CapacitorKV.get('tokenNotificaciones');
  const token = guardado && guardado.value;
  if (!token) return { recordatorios: 0, motivo: 'sin sesión' };

  const cabeceras = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'PremierCanApp/1.0',
    'ngrok-skip-browser-warning': '1',
    'Content-Type': 'application/json',
  };
  const respuesta = await fetch(`${SERVIDOR}/api/cliente/app/notificaciones`, { method: 'GET', headers: cabeceras });
  if (respuesta.status === 401) {
    CapacitorKV.remove('tokenNotificaciones'); // venció o no es válido: se renueva al abrir la app
    return { recordatorios: 0, motivo: 'token vencido' };
  }
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const pendientes = JSON.parse(await respuesta.text());
  if (!pendientes.length) return { recordatorios: 0 };

  CapacitorNotifications.schedule(pendientes.slice(0, MAX_POR_REVISION).map((r) => ({
    // El servidor ya manda el id correcto (incluye avisos personalizados: 5000000 + id)
    id: r.idNotificacion || ((r.tipo === 'Cita' ? OFFSET_CITA : OFFSET_PREVENTIVO) + r.pacienteId),
    title: r.titulo,
    body: r.cuerpo,
    largeBody: r.cuerpo,
    actionTypeId: 'recordatorio',
    smallIcon: 'ic_stat_promo',
    autoCancel: true,
  })));

  // Avisar al servidor que ya se mostraron, para que no se repitan
  const ids = pendientes.slice(0, MAX_POR_REVISION).map((r) => r.recordatorioId);
  await fetch(`${SERVIDOR}/api/cliente/app/notificaciones/confirmar`, {
    method: 'POST', headers: cabeceras, body: JSON.stringify({ ids }),
  });
  return { recordatorios: ids.length };
}

// Evento periódico (configurado en capacitor.config.json) y al abrir la app.
// Cada parte va por separado: si falla una, la otra igual se revisa.
addEventListener('revisarNovedades', async (resolve) => {
  const resultado = {};
  try { resultado.promociones = await revisar(); } catch (err) { resultado.errorPromociones = String(err); }
  try { resultado.recordatorios = await revisarRecordatorios(); } catch (err) { resultado.errorRecordatorios = String(err); }
  console.log(`Novedades revisadas: ${JSON.stringify(resultado)}`);
  resolve(resultado);
});

// Nombre anterior del evento (por si alguna página vieja lo sigue pidiendo)
addEventListener('revisarPromociones', async (resolve, reject) => {
  try { resolve(await revisar()); } catch (err) { reject(err); }
});

// La app entrega / quita el token del cliente (al iniciar o cerrar sesión)
addEventListener('guardarCliente', (resolve, reject, args) => {
  if (args && args.token) CapacitorKV.set('tokenNotificaciones', String(args.token));
  resolve({ guardado: !!(args && args.token) });
});
addEventListener('olvidarCliente', (resolve) => {
  CapacitorKV.remove('tokenNotificaciones');
  resolve({ olvidado: true });
});
