// utils/horarios.js
//
// Reglas de horario compartidas entre citas.controller.js (panel del
// staff) y clienteApp.controller.js (portal de propietarios), para que
// ambos canales de creación de citas respeten EXACTAMENTE las mismas
// reglas de negocio:
//
//   1) La clínica atiende de lunes a sábado, de 7:00 a. m. a 12:00 a. m.
//      (medianoche) — nunca domingo, nunca fuera de ese rango.
//   2) Cada veterinario tiene un horario de trabajo propio (tabla
//      HorariosVeterinario: qué días y en qué rango de horas atiende).
//   3) Al crear una cita, si no se indica un veterinario a mano, el
//      sistema busca automáticamente uno cuyo horario cubra ese día/hora
//      y que no tenga ya otra cita que se cruce. Si no encuentra a
//      nadie, la cita se guarda sin veterinario y un administrador debe
//      asignarlo manualmente después (ver citas.html, modal de detalle).
//   4) La MISMA mascota tampoco puede tener dos citas que se crucen en
//      el horario (con o sin veterinario asignado todavía).
//   5) El mismo DUEÑO tampoco: no puede tener a dos de sus mascotas en
//      citas que se crucen (él es quien las trae).
//   6) No se agenda en el pasado, y desde el portal de clientes como
//      mucho con 6 meses de anticipación.
//   Todo esto se revisa y se guarda dentro de conAgendaBloqueada, para
//   que dos pedidos simultáneos no puedan colarse a la vez.
//
// IMPORTANTE sobre fechas: FechaHora se trata como "hora literal de Perú"
// (América/Lima), NO como un instante real con zona horaria. Es decir,
// "2026-09-21T09:00:00" siempre significa "las 9 de la mañana en Perú",
// sin importar en qué zona horaria esté corriendo el servidor (en local
// era una, en Azure puede ser otra). Por eso NUNCA se usa `new Date(texto)`
// directo ni los métodos locales (getHours, getDay, etc.) — esos dependen
// de la zona horaria de la máquina que ejecuta el código. En su lugar,
// se parsean los dígitos a mano y se guardan en los campos UTC de un
// Date (comoFechaLiteralUTC) y se leen siempre con los métodos getUTC*.
// Esto hace que el resultado sea el mismo sin importar dónde corra el
// servidor o en qué zona horaria esté el navegador de quien lo mira.
const { sql } = require('../config/db');

const HORA_APERTURA = '07:00';
// Límite práctico de un día en formato 24h (nada puede pasar de 23:59).
// Representa "hasta medianoche" — no existe un '24:00' válido como hora.
const HORA_CIERRE = '23:59';
const HORA_APERTURA_TEXTO = '7:00 a. m.';
const HORA_CIERRE_TEXTO = '12:00 a. m. (medianoche)';

// Duración estimada por tipo de cita (minutos). Se usa SOLO para calcular
// si dos citas se pisan en el horario, y si una cita cabe completa dentro
// del horario de atención — no se guarda en la base de datos.
const DURACION_MIN = { Consulta: 30, Vacunacion: 20, CirugiaMenor: 90, Urgencia: 60, BanoPeluqueria: 60 };

// Convierte un texto "YYYY-MM-DDTHH:mm[:ss]" (lo que manda el frontend) o
// un Date que ya vino de la base de datos, a un Date cuyos campos UTC
// contienen la hora literal de Perú. Si ya es un Date (por ejemplo
// c.FechaHora leído de SQL Server), se devuelve tal cual: como el
// backend SIEMPRE guarda con este mismo método, sus campos UTC ya son
// la hora literal correcta.
function comoFechaLiteralUTC(entrada) {
  if (entrada instanceof Date) return entrada;
  const m = String(entrada).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(entrada); // no debería pasar, pero evita un crash
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0)));
}

function rangoDeCita(fechaHoraIso, tipoCita) {
  const inicio = comoFechaLiteralUTC(fechaHoraIso);
  const duracion = DURACION_MIN[tipoCita] || 30;
  const fin = new Date(inicio.getTime() + duracion * 60000);
  return { inicio, fin };
}

function horaHHMM(fecha) {
  return `${String(fecha.getUTCHours()).padStart(2, '0')}:${String(fecha.getUTCMinutes()).padStart(2, '0')}`;
}

// 0 = Domingo, 1 = Lunes ... 6 = Sábado (igual que Date#getUTCDay()).
// HorariosVeterinario.DiaSemana usa la misma convención, pero solo
// permite 1-6 (nunca domingo).
function diaSemanaDe(fechaHoraIso) {
  return comoFechaLiteralUTC(fechaHoraIso).getUTCDay();
}

// Valida que la cita caiga dentro del horario de atención: lunes a
// sábado (nunca domingo), desde las 7:00 a. m. y hasta medianoche —
// considerando la duración del tipo de cita, para que ni "empiece antes
// de que abra" ni "termine ya entrado el día siguiente" (una cita que
// arranca cerca de medianoche y dura, por ejemplo, una cirugía menor de
// 90 minutos, se pasaría al día siguiente: eso también se rechaza).
function validarHorarioClinica(fechaHoraIso, tipoCita) {
  const dia = diaSemanaDe(fechaHoraIso);
  if (dia === 0) {
    return 'La clínica no atiende los domingos. Elige un día de lunes a sábado.';
  }

  const { inicio, fin } = rangoDeCita(fechaHoraIso, tipoCita);
  const horaInicio = horaHHMM(inicio);

  if (horaInicio < HORA_APERTURA) {
    return `La clínica abre a las ${HORA_APERTURA_TEXTO}; elige un horario más tarde.`;
  }
  // Si la cita (con su duración) termina en un día calendario distinto
  // al que empezó, significa que se pasó de medianoche.
  const mismoDia = fin.getUTCFullYear() === inicio.getUTCFullYear()
    && fin.getUTCMonth() === inicio.getUTCMonth()
    && fin.getUTCDate() === inicio.getUTCDate();
  if (!mismoDia) {
    return `La clínica cierra a las ${HORA_CIERRE_TEXTO}. Con la duración de este tipo de cita, terminaría después de medianoche — elige un horario más temprano.`;
  }
  return null;
}

// Revisa si ya existe otra cita ACTIVA (no cancelada) del mismo
// veterinario cuyo horario se cruza con el de la cita que se quiere
// guardar. Si veterinarioId es null (todavía sin asignar), no hay nada
// que chocar, así que no se revisa nada.
async function hayChoqueDeHorario(pool, veterinarioId, fechaHoraIso, tipoCita, citaIdExcluir = null) {
  if (!veterinarioId) return null;

  const { inicio, fin } = rangoDeCita(fechaHoraIso, tipoCita);
  const inicioDia = new Date(inicio); inicioDia.setUTCHours(0, 0, 0, 0);
  const finDia = new Date(inicio); finDia.setUTCHours(23, 59, 59, 999);

  const result = await pool
    .request()
    .input('veterinarioId', sql.Int, veterinarioId)
    .input('desde', sql.DateTime2, inicioDia)
    .input('hasta', sql.DateTime2, finDia)
    .query(`
      SELECT c.CitaID, c.FechaHora, c.TipoCita, p.Nombre AS PacienteNombre
      FROM Citas c
      INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      WHERE c.VeterinarioID = @veterinarioId
        AND c.Estado <> 'Cancelada'
        AND c.FechaHora BETWEEN @desde AND @hasta
    `);

  for (const otra of result.recordset) {
    if (citaIdExcluir && otra.CitaID === Number(citaIdExcluir)) continue;
    const { inicio: otroInicio, fin: otroFin } = rangoDeCita(otra.FechaHora, otra.TipoCita);
    const seCruzan = inicio < otroFin && fin > otroInicio;
    if (seCruzan) {
      const horaTexto = otra.FechaHora.toISOString().substring(11, 16);
      return `El veterinario ya tiene otra cita a esa hora (${otra.PacienteNombre}, ${horaTexto}). Elige otro horario.`;
    }
  }
  return null;
}

// Revisa si la MISMA mascota ya tiene otra cita ACTIVA (no cancelada)
// cuyo horario se cruza con el de la cita que se quiere guardar. A
// diferencia de hayChoqueDeHorario, esto se revisa SIEMPRE — incluso si
// la cita todavía no tiene veterinario asignado — porque una mascota no
// puede estar en dos citas al mismo tiempo, tenga o no veterinario.
async function hayChoqueDePaciente(pool, pacienteId, fechaHoraIso, tipoCita, citaIdExcluir = null) {
  const { inicio, fin } = rangoDeCita(fechaHoraIso, tipoCita);
  const inicioDia = new Date(inicio); inicioDia.setUTCHours(0, 0, 0, 0);
  const finDia = new Date(inicio); finDia.setUTCHours(23, 59, 59, 999);

  const result = await pool
    .request()
    .input('pacienteId', sql.Int, pacienteId)
    .input('desde', sql.DateTime2, inicioDia)
    .input('hasta', sql.DateTime2, finDia)
    .query(`
      SELECT c.CitaID, c.FechaHora, c.TipoCita, p.Nombre AS PacienteNombre
      FROM Citas c
      INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      WHERE c.PacienteID = @pacienteId
        AND c.Estado <> 'Cancelada'
        AND c.FechaHora BETWEEN @desde AND @hasta
    `);

  const TIPO_TEXTO = { Consulta: 'consulta', Vacunacion: 'vacunación', CirugiaMenor: 'cirugía menor', Urgencia: 'urgencia', BanoPeluqueria: 'baño y peluquería' };
  for (const otra of result.recordset) {
    if (citaIdExcluir && otra.CitaID === Number(citaIdExcluir)) continue;
    const { inicio: otroInicio, fin: otroFin } = rangoDeCita(otra.FechaHora, otra.TipoCita);
    const seCruzan = inicio < otroFin && fin > otroInicio;
    if (seCruzan) {
      return `${otra.PacienteNombre} ya tiene una cita de ${TIPO_TEXTO[otra.TipoCita] || 'consulta'} ese día de `
        + `${horaHHMM(otroInicio)} a ${horaHHMM(otroFin)}. Elige otro horario.`;
    }
  }
  return null;
}

// Revisa si el mismo DUEÑO ya tiene otra cita ACTIVA con OTRA de sus
// mascotas que se cruza con la que se quiere guardar. El dueño es quien
// trae a sus mascotas, así que no puede estar en dos citas a la vez
// (antes el portal dejaba agendar al perro y al gato a la misma hora).
// La mascota misma se revisa aparte, en hayChoqueDePaciente.
// Se toma el dueño ACTUAL de cada mascota (Pacientes.PropietarioID).
async function hayChoqueDePropietario(pool, propietarioId, pacienteId, fechaHoraIso, tipoCita, { citaIdExcluir = null, paraCliente = false } = {}) {
  if (!propietarioId) return null;
  const { inicio, fin } = rangoDeCita(fechaHoraIso, tipoCita);
  const inicioDia = new Date(inicio); inicioDia.setUTCHours(0, 0, 0, 0);
  const finDia = new Date(inicio); finDia.setUTCHours(23, 59, 59, 999);

  const result = await pool
    .request()
    .input('propietarioId', sql.Int, propietarioId)
    .input('pacienteId', sql.Int, pacienteId)
    .input('desde', sql.DateTime2, inicioDia)
    .input('hasta', sql.DateTime2, finDia)
    .query(`
      SELECT c.CitaID, c.FechaHora, c.TipoCita, p.Nombre AS PacienteNombre
      FROM Citas c
      INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      WHERE p.PropietarioID = @propietarioId
        AND c.PacienteID <> @pacienteId
        AND c.Estado <> 'Cancelada'
        AND c.FechaHora BETWEEN @desde AND @hasta
    `);

  for (const otra of result.recordset) {
    if (citaIdExcluir && otra.CitaID === Number(citaIdExcluir)) continue;
    const { inicio: otroInicio, fin: otroFin } = rangoDeCita(otra.FechaHora, otra.TipoCita);
    if (inicio < otroFin && fin > otroInicio) {
      const rango = `${horaHHMM(otroInicio)} a ${horaHHMM(otroFin)}`;
      return paraCliente
        ? `Ya tienes una cita para ${otra.PacienteNombre} ese día de ${rango}. No puedes tener dos mascotas en citas al mismo tiempo: elige otro horario (por ejemplo, desde las ${horaHHMM(otroFin)}).`
        : `El dueño ya tiene una cita para ${otra.PacienteNombre} de ${rango} y no puede estar en dos citas a la vez. Elige otro horario (por ejemplo, desde las ${horaHHMM(otroFin)}).`;
    }
  }
  return null;
}

// Valida los datos básicos de la cita ANTES de tocar la base de datos, para
// responder un mensaje claro (400) en vez de un error genérico cuando la
// tabla rechaza un valor por sus CHECK.
const METODOS_PAGO = ['Efectivo', 'Tarjeta', 'Yape', 'Plin'];
const MAX_DIAS_ANTICIPACION_CLIENTE = 180;

function validarDatosCita({ fechaHora, tipoCita, metodoPago, motivo }, { paraCliente = false } = {}) {
  if (!DURACION_MIN[tipoCita]) return 'Tipo de cita no válido.';
  if (metodoPago && !METODOS_PAGO.includes(metodoPago)) return 'Método de pago no válido.';
  if (motivo && String(motivo).length > 200) return 'El motivo no puede pasar de 200 caracteres.';
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(fechaHora || ''))) return 'La fecha y hora no son válidas.';

  const inicio = comoFechaLiteralUTC(fechaHora);
  if (Number.isNaN(inicio.getTime())) return 'La fecha y hora no son válidas.';

  // "Ahora" en hora literal de Perú (UTC-5, sin horario de verano), con el
  // mismo criterio de fechas literales que el resto de este archivo.
  const ahoraLima = new Date(Date.now() - 5 * 3600 * 1000);
  if (inicio <= ahoraLima) return 'No se puede agendar una cita en una fecha u hora que ya pasó.';
  if (paraCliente && inicio - ahoraLima > MAX_DIAS_ANTICIPACION_CLIENTE * 86400000) {
    return `Solo se pueden agendar citas con hasta ${MAX_DIAS_ANTICIPACION_CLIENTE / 30} meses de anticipación.`;
  }
  return null;
}

// Ejecuta fn dentro de una transacción con un bloqueo exclusivo de la agenda
// (sp_getapplock). Así, dos pedidos simultáneos (doble clic, dos celulares
// del mismo dueño, dos recepcionistas) no pueden pasar las validaciones a la
// vez y terminar creando dos citas que se pisan. fn recibe la transacción,
// que se usa igual que el pool (tx.request()).
async function conAgendaBloqueada(pool, fn) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const lock = await tx.request().query(`
      DECLARE @r INT;
      EXEC @r = sp_getapplock @Resource = 'PremierCan_Agenda', @LockMode = 'Exclusive',
                              @LockOwner = 'Transaction', @LockTimeout = 10000;
      SELECT @r AS resultado;
    `);
    if (lock.recordset[0].resultado < 0) {
      throw Object.assign(new Error('La agenda está ocupada, intenta de nuevo en unos segundos.'), { status: 503 });
    }
    const resultado = await fn(tx);
    await tx.commit();
    return resultado;
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* ya estaba cerrada */ }
    throw err;
  }
}

// Busca, entre los veterinarios activos cuyo horario de trabajo
// (HorariosVeterinario) cubre el día y el rango completo de la cita, el
// primero que además no tenga un choque con otra cita ya agendada.
// Devuelve el UsuarioID del elegido, o null si ninguno califica — en ese
// caso la cita se crea sin veterinario y un administrador debe asignarlo
// a mano desde el panel.
async function buscarVeterinarioDisponible(pool, fechaHoraIso, tipoCita) {
  return (await disponibilidadVeterinarios(pool, fechaHoraIso, tipoCita)).veterinarioId;
}

/**
 * Igual que buscarVeterinarioDisponible, pero además dice POR QUÉ no hay nadie:
 *   { veterinarioId, motivo: null }            -> hay un veterinario libre
 *   { veterinarioId: null, motivo: 'sin_horario' } -> a esa hora no trabaja ningún veterinario
 *   { veterinarioId: null, motivo: 'ocupado' }     -> trabajan, pero todos tienen otra cita
 */
async function disponibilidadVeterinarios(pool, fechaHoraIso, tipoCita) {
  const dia = diaSemanaDe(fechaHoraIso);
  if (dia === 0) return { veterinarioId: null, motivo: 'sin_horario' }; // domingo: nunca hay nadie trabajando

  const { inicio, fin } = rangoDeCita(fechaHoraIso, tipoCita);
  const horaInicio = horaHHMM(inicio);
  const horaFin = horaHHMM(fin);

  const candidatos = await pool
    .request()
    .input('diaSemana', sql.TinyInt, dia)
    .input('horaInicio', sql.VarChar(5), horaInicio)
    .input('horaFin', sql.VarChar(5), horaFin)
    .query(`
      SELECT h.UsuarioID
      FROM HorariosVeterinario h
      INNER JOIN Usuarios u ON u.UsuarioID = h.UsuarioID
      WHERE h.DiaSemana = @diaSemana
        AND h.HoraInicio <= @horaInicio
        AND h.HoraFin >= @horaFin
        AND u.Activo = 1
      ORDER BY h.UsuarioID
    `);

  if (!candidatos.recordset.length) return { veterinarioId: null, motivo: 'sin_horario' };
  for (const candidato of candidatos.recordset) {
    const choque = await hayChoqueDeHorario(pool, candidato.UsuarioID, fechaHoraIso, tipoCita);
    if (!choque) return { veterinarioId: candidato.UsuarioID, motivo: null };
  }
  return { veterinarioId: null, motivo: 'ocupado' };
}

/**
 * Horarios libres del MISMO día, los más cercanos a la hora pedida (cada 30 min):
 * dentro del horario de la clínica, en el futuro, con un veterinario libre y sin
 * que la mascota ni su dueño tengan otra cita a esa hora. Devuelve ['09:30', ...]
 * en orden de hora. Se usa para sugerirle al cliente cuando el horario está ocupado.
 */
async function horariosLibresCercanos(pool, fechaHoraIso, tipoCita, { pacienteId, propietarioId, max = 4 } = {}) {
  const pedido = comoFechaLiteralUTC(fechaHoraIso);
  const dia = String(fechaHoraIso).slice(0, 10);
  const ahoraLima = new Date(Date.now() - 5 * 3600 * 1000);

  const candidatos = [];
  for (let min = 7 * 60; min <= 23 * 60 + 30; min += 30) {
    const hhmm = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
    const iso = `${dia}T${hhmm}:00`;
    const inicio = comoFechaLiteralUTC(iso);
    if (inicio.getTime() === pedido.getTime() || inicio <= ahoraLima) continue;
    if (validarHorarioClinica(iso, tipoCita)) continue;
    candidatos.push({ hhmm, iso, distancia: Math.abs(inicio - pedido) });
  }
  candidatos.sort((a, b) => a.distancia - b.distancia);

  const libres = [];
  for (const c of candidatos) {
    if (libres.length >= max) break;
    const { veterinarioId } = await disponibilidadVeterinarios(pool, c.iso, tipoCita);
    if (!veterinarioId) continue;
    if (pacienteId && await hayChoqueDePaciente(pool, pacienteId, c.iso, tipoCita)) continue;
    if (propietarioId && await hayChoqueDePropietario(pool, propietarioId, pacienteId, c.iso, tipoCita)) continue;
    libres.push(c.hhmm);
  }
  return libres.sort();
}

module.exports = {
  HORA_APERTURA,
  HORA_CIERRE,
  HORA_APERTURA_TEXTO,
  HORA_CIERRE_TEXTO,
  DURACION_MIN,
  comoFechaLiteralUTC,
  rangoDeCita,
  validarHorarioClinica,
  hayChoqueDeHorario,
  hayChoqueDePaciente,
  hayChoqueDePropietario,
  validarDatosCita,
  conAgendaBloqueada,
  buscarVeterinarioDisponible,
  disponibilidadVeterinarios,
  horariosLibresCercanos,
};