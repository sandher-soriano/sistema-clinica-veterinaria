// utils/recordatorios-auto.js
// Recordatorios automáticos para los CLIENTES (dueños de mascotas).
//
//  - generarRecordatorios(): crea los que falten
//      * próximas dosis (vacuna / desparasitación) según ReglasRecordatorioAutomatico
//      * citas: avisos a los 10 días, 3 días, 1 día y 5 horas antes (HITOS_CITA)
//  - enviarPorCorreo(): manda por correo los que ya "tocan" y aún no se enviaron
//  - pendientesParaApp() / confirmarEnApp(): la app del cliente los recoge (ver
//    routes/cliente.routes.js -> /app/notificaciones) y confirma que los mostró
//  - iniciarTareaProgramada(): corre todo cada 15 minutos desde server.js
//
// ¿Cuándo "toca" enviar uno?
//   * Vacuna / Desparasitación: desde (FechaProgramada - DiasAntes de su regla)
//   * Cita automática: apenas llega su hito (y nunca después de empezar la cita)
//   * Otros (creados a mano por el staff): desde FechaProgramada
// Solo Destino = 'Cliente'. Las alertas internas (Destino = 'Staff') nunca salen.
//
// Fechas: igual que utils/horarios.js, FechaProgramada/FechaHora son hora literal
// de Perú; "ahora" en Perú se calcula en SQL como DATEADD(HOUR, -5, SYSUTCDATETIME()).
const { sql, getPool } = require('../config/db');
const { enviarCorreo, plantillaCorreo, proveedorActivo } = require('./correo');
const { actualizarEstadosEsquemas } = require('./estadoEsquemas');

const AHORA_LIMA = 'DATEADD(HOUR, -5, SYSUTCDATETIME())';
const MAX_INTENTOS_CORREO = 5;

// Fila única: generar y enviar NUNCA corren dos a la vez. Antes, la tarea de
// cada 15 min, "generar-automaticos" (al abrir Recordatorios), "Enviar ahora" y
// los avisos podían leer los mismos pendientes a la vez y mandar 2 correos al
// mismo cliente, o crear recordatorios duplicados. Al ir en fila, cada uno lee
// los pendientes DESPUÉS de que el anterior ya marcó lo que envió.
let fila = Promise.resolve();
function enFila(tarea) {
  const resultado = fila.then(tarea, tarea);
  fila = resultado.catch(() => {});
  return resultado;
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

// Avisos de cita: cuántas horas antes se avisa (de mayor a menor)
const HITOS_CITA = [
  { codigo: '10d', horas: 240, texto: '10 días antes' },
  { codigo: '3d', horas: 72, texto: '3 días antes' },
  { codigo: '1d', horas: 24, texto: '1 día antes' },
  { codigo: '5h', horas: 5, texto: '5 horas antes' },
];

// Tipo de esquema (con tilde, tabla TiposEsquemaPreventivo) -> tipo de recordatorio
const TIPO_ESQUEMA_A_RECORDATORIO = { 'Vacuna': 'Vacuna', 'Desparasitación': 'Desparasitacion' };

// Condición SQL "ya toca avisar" para un recordatorio r (con su regla g, si tiene)
const YA_TOCA = `
  (
    (r.TipoRecordatorio IN ('Vacuna', 'Desparasitacion')
       AND DATEADD(DAY, -ISNULL(g.DiasAntes, 7), CAST(r.FechaProgramada AS DATE)) <= CAST(${AHORA_LIMA} AS DATE))
    -- Cita automática: se crea justo al llegar su hito, así que toca de inmediato
    -- (pero nunca después de que la cita ya empezó)
    OR (r.TipoRecordatorio = 'Cita' AND r.CitaID IS NOT NULL AND r.FechaProgramada > ${AHORA_LIMA})
    -- Recordatorio de cita creado a mano por el staff: desde 24 h antes
    OR (r.TipoRecordatorio = 'Cita' AND r.CitaID IS NULL AND DATEADD(HOUR, -24, r.FechaProgramada) <= ${AHORA_LIMA})
    OR (r.TipoRecordatorio = 'ControlGeneral' AND r.FechaProgramada <= ${AHORA_LIMA})
  )`;

function fechaTexto(fecha) {
  return `${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()]}`;
}
function horaTexto(fecha) {
  return `${String(fecha.getUTCHours()).padStart(2, '0')}:${String(fecha.getUTCMinutes()).padStart(2, '0')}`;
}

/** Título y texto amigables de un recordatorio (los mismos para correo y app). */
function textoRecordatorio(r) {
  if (r.TipoRecordatorio === 'Aviso') {
    return { titulo: r.Titulo || 'Aviso de Premier Can', cuerpo: r.Mensaje || '' };
  }
  const fecha = r.FechaProgramada;
  if (r.TipoRecordatorio === 'Cita') {
    // El texto se arma al momento de enviar, con el tiempo que realmente falta
    const ahoraLima = Date.now() - 5 * 3600 * 1000;
    const hoyLima = new Date(ahoraLima).toISOString().slice(0, 10);
    const manana = new Date(ahoraLima + 86400000).toISOString().slice(0, 10);
    const dia = fecha.toISOString().slice(0, 10);
    const horasFaltan = Math.max(0, (fecha.getTime() - ahoraLima) / 3600000);
    const hora = horaTexto(fecha);
    let titulo;
    if (dia === hoyLima) {
      const enCuanto = horasFaltan < 1 ? 'en menos de 1 hora' : `en ${Math.round(horasFaltan)} hora${Math.round(horasFaltan) === 1 ? '' : 's'}`;
      titulo = `⏰ Hoy a las ${hora}: cita de ${r.PacienteNombre} (${enCuanto})`;
    } else if (dia === manana) {
      // De madrugada "mañana" puede ser en pocas horas: se aclara cuánto falta
      const enHoras = horasFaltan < 12 ? ` (en ${Math.round(horasFaltan)} horas)` : '';
      titulo = `${horasFaltan < 12 ? '⏰' : '📅'} Mañana a las ${hora}: cita de ${r.PacienteNombre}${enHoras}`;
    } else {
      const dias = Math.round((Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${hoyLima}T00:00:00Z`)) / 86400000);
      titulo = `🐾 En ${dias} días: cita de ${r.PacienteNombre} (${fechaTexto(fecha)}, ${hora})`;
    }
    const cuerpo = horasFaltan <= 6
      ? '¡Ya casi! Te esperamos en Premier Can. Si se te complica, avísanos para reprogramarla.'
      : 'Te esperamos en Premier Can. Si no puedes asistir, avísanos para reprogramarla.';
    return { titulo, cuerpo };
  }
  const emoji = r.TipoRecordatorio === 'Vacuna' ? '💉' : r.TipoRecordatorio === 'Desparasitacion' ? '🛡️' : '🐾';
  const que = r.TipoRecordatorio === 'Vacuna' ? 'su vacuna' : r.TipoRecordatorio === 'Desparasitacion' ? 'su desparasitación' : 'un control';
  return {
    titulo: `${emoji} ${r.PacienteNombre} tiene ${que} el ${fechaTexto(fecha)}`,
    cuerpo: r.Mensaje || `Agenda su cita desde la app para mantenerlo protegido.`,
  };
}

/** Crea los recordatorios que falten. Devuelve cuántos creó. */
function generarRecordatorios(pool) {
  return enFila(() => generarRecordatoriosAhora(pool));
}
async function generarRecordatoriosAhora(pool) {
  let creados = 0;

  // 1) Próximas dosis según las reglas activas
  const reglas = (await pool.request().query('SELECT * FROM ReglasRecordatorioAutomatico WHERE Activo = 1')).recordset;
  for (const regla of reglas) {
    const nombreTipoEsquema = Object.keys(TIPO_ESQUEMA_A_RECORDATORIO)
      .find((k) => TIPO_ESQUEMA_A_RECORDATORIO[k] === regla.TipoRecordatorio);
    if (!nombreTipoEsquema) continue;

    // Se crea (sin repetir) si la dosis cae dentro de los próximos DiasAntes días.
    // "Sin repetir" = no existe ya uno de la misma mascota, tipo y fecha, en CUALQUIER
    // estado (antes solo se miraban los Pendientes y, una vez enviado, se volvía a crear).
    const result = await pool.request()
      .input('nombreTipo', sql.NVarChar, nombreTipoEsquema)
      .input('tipoRecordatorio', sql.NVarChar, regla.TipoRecordatorio)
      .input('diasAntes', sql.Int, regla.DiasAntes)
      .query(`
        INSERT INTO Recordatorios (PacienteID, PropietarioID, TipoRecordatorio, FechaProgramada, Canal, Estado, Mensaje, Destino)
        SELECT e.PacienteID, p.PropietarioID, @tipoRecordatorio, e.FechaProximaDosis, 'Push', 'Pendiente',
               CONCAT(p.Nombre, N' tiene "', e.NombreProducto, N'" programada para el ', CONVERT(VARCHAR(10), e.FechaProximaDosis, 23), N'.'),
               'Cliente'
        FROM EsquemasPreventivos e
        INNER JOIN TiposEsquemaPreventivo t ON t.TipoEsquemaID = e.TipoEsquemaID
        INNER JOIN Pacientes p ON p.PacienteID = e.PacienteID
        INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
        WHERE e.FechaAplicacion IS NULL
          AND p.Activo = 1 AND pr.Activo = 1
          AND t.NombreTipo = @nombreTipo
          -- también las atrasadas del último mes (para que el staff las vea y llame;
          -- al cliente no se le envían porque consultaQueTocan descarta lo vencido)
          AND e.FechaProximaDosis >= DATEADD(DAY, -30, CAST(${AHORA_LIMA} AS DATE))
          AND e.FechaProximaDosis <= DATEADD(DAY, @diasAntes, CAST(${AHORA_LIMA} AS DATE))
          AND NOT EXISTS (
            SELECT 1 FROM Recordatorios r
            WHERE r.PacienteID = e.PacienteID AND r.TipoRecordatorio = @tipoRecordatorio
              AND CAST(r.FechaProgramada AS DATE) = CAST(e.FechaProximaDosis AS DATE)
          )
      `);
    creados += result.rowsAffected[0] || 0;
  }

  // 2) Citas: avisos escalonados (10 días, 3 días, 1 día y 5 horas antes).
  //    Para cada cita se crea solo el hito MÁS CERCANO que ya llegó: si alguien
  //    agenda con 2 días de anticipación, recibe un aviso ("en 2 días") y no
  //    también los de 10 y 3 días de golpe.
  const citas = (await pool.request().query(`
    SELECT c.CitaID, c.PacienteID, p.PropietarioID, p.Nombre AS PacienteNombre, c.FechaHora,
           DATEDIFF(MINUTE, ${AHORA_LIMA}, c.FechaHora) AS MinutosFaltan
    FROM Citas c
    INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
    INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
    WHERE c.Estado IN ('Programada', 'Confirmada')
      AND p.Activo = 1 AND pr.Activo = 1  -- mascota o dueño desactivados: no se avisa
      AND c.FechaHora > ${AHORA_LIMA}
      AND c.FechaHora <= DATEADD(HOUR, ${HITOS_CITA[0].horas}, ${AHORA_LIMA})
  `)).recordset;

  for (const cita of citas) {
    const hito = HITOS_CITA.filter((h) => cita.MinutosFaltan <= h.horas * 60).pop();
    if (!hito) continue;
    const insert = await pool.request()
      .input('citaId', sql.Int, cita.CitaID)
      .input('pacienteId', sql.Int, cita.PacienteID)
      .input('propietarioId', sql.Int, cita.PropietarioID)
      .input('fechaHora', sql.DateTime2, cita.FechaHora)
      .input('hito', sql.NVarChar(5), hito.codigo)
      .input('mensaje', sql.NVarChar, `Aviso ${hito.texto}: cita de ${cita.PacienteNombre}.`)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM Recordatorios
                       WHERE CitaID = @citaId AND Anticipacion = @hito AND FechaProgramada = @fechaHora)
          INSERT INTO Recordatorios (PacienteID, PropietarioID, TipoRecordatorio, FechaProgramada, Canal, Estado, Mensaje, Destino, CitaID, Anticipacion)
          VALUES (@pacienteId, @propietarioId, 'Cita', @fechaHora, 'Push', 'Pendiente', @mensaje, 'Cliente', @citaId, @hito)
      `);
    if (insert.rowsAffected[0]) {
      creados++;
      // Si quedó pendiente un hito anterior (ej. el servidor estuvo apagado), ya no se envía
      await pool.request()
        .input('citaId', sql.Int, cita.CitaID)
        .input('hito', sql.NVarChar(5), hito.codigo)
        .query(`
          UPDATE Recordatorios SET Estado = 'Fallido', Mensaje = CONCAT(N'[Reemplazado por un aviso más cercano] ', Mensaje)
          WHERE CitaID = @citaId AND Estado = 'Pendiente' AND Anticipacion <> @hito
        `);
    }
  }

  // 3) Si una cita se canceló o reprogramó, su recordatorio pendiente ya no sirve
  await pool.request().query(`
    UPDATE r SET r.Estado = 'Fallido', r.Mensaje = CONCAT(N'[No enviado: la cita cambió] ', r.Mensaje)
    FROM Recordatorios r INNER JOIN Citas c ON c.CitaID = r.CitaID
    WHERE r.Estado = 'Pendiente' AND (c.Estado IN ('Cancelada', 'Completada', 'NoAsistio') OR c.FechaHora <> r.FechaProgramada)
  `);

  return creados;
}

// Recordatorios de cliente que ya tocan (con los datos para armar el texto)
// Recordatorios de cliente que ya tocan (con los datos para armar el texto).
//  - EnviarDesde (aviso programado o "Enviar ahora"): se envía desde esa hora,
//    como mucho 2 días después (si el servidor estuvo apagado más, ya no).
//  - Si no, se usan las reglas normales (YA_TOCA) y nunca algo ya vencido.
//  - Los marcados "Ya avisé por teléfono" (CanalEnvio con 'Manual') nunca salen.
function consultaQueTocan(filtroExtra) {
  return `
    SELECT r.RecordatorioID, r.TipoRecordatorio, r.FechaProgramada, r.Mensaje, r.Titulo, r.CanalEnvio,
           r.PacienteID, p.Nombre AS PacienteNombre,
           ISNULL(r.PacienteID, (SELECT TOP 1 px.PacienteID FROM Pacientes px
                                 WHERE px.PropietarioID = pr.PropietarioID AND px.Activo = 1
                                 ORDER BY px.PacienteID)) AS PacienteIDApp,
           pr.PropietarioID, pr.Nombres AS PropietarioNombres, pr.CorreoElectronico
    FROM Recordatorios r
    LEFT JOIN Pacientes p ON p.PacienteID = r.PacienteID
    INNER JOIN Propietarios pr ON pr.PropietarioID = r.PropietarioID
    LEFT JOIN ReglasRecordatorioAutomatico g ON g.TipoRecordatorio = r.TipoRecordatorio
    WHERE r.Destino = 'Cliente'
      AND r.Estado <> 'Fallido'
      -- Nunca a dueños desactivados, ni sobre mascotas desactivadas (p. ej. fallecidas)
      AND pr.Activo = 1
      AND (r.PacienteID IS NULL OR p.Activo = 1)
      AND (r.CanalEnvio IS NULL OR CHARINDEX('Manual', r.CanalEnvio) = 0)
      AND (
        (r.EnviarDesde IS NOT NULL AND r.EnviarDesde <= ${AHORA_LIMA}
           AND r.EnviarDesde >= DATEADD(DAY, -2, ${AHORA_LIMA}))
        OR (r.EnviarDesde IS NULL
           AND r.FechaProgramada >= DATEADD(DAY, -1, CAST(${AHORA_LIMA} AS DATE))  -- nada ya vencido
           AND ${YA_TOCA})
      )
      ${filtroExtra}`;
}

function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Id de la notificación en el celular (ver MainActivity.java):
//   3000000 + PacienteID -> vacuna/desparasitación | 4000000 + PacienteID -> cita
//   5000000 + id         -> aviso personalizado (abre "Mis avisos")
function idNotificacion(r) {
  if (r.TipoRecordatorio === 'Aviso') return 5000000 + (r.RecordatorioID % 1000000);
  return (r.TipoRecordatorio === 'Cita' ? 4000000 : 3000000) + (r.PacienteIDApp || 0);
}

async function marcarEnviado(pool, recordatorioId, canal) {
  // CanalEnvio acumula por dónde salió: 'Correo', 'App' o 'Correo+App'
  await pool.request()
    .input('id', sql.Int, recordatorioId)
    .input('canal', sql.NVarChar, canal)
    .query(`
      UPDATE Recordatorios SET
        Estado = 'Enviado',
        EnviadoEn = ISNULL(EnviadoEn, SYSDATETIME()),
        CanalEnvio = CASE
          WHEN CanalEnvio IS NULL THEN @canal
          WHEN CHARINDEX(@canal, CanalEnvio) > 0 THEN CanalEnvio
          ELSE CONCAT(CanalEnvio, '+', @canal) END
      WHERE RecordatorioID = @id
    `);
}

/**
 * Envía por correo los que tocan y aún no salieron por correo.
 * soloId: para "Enviar ahora" de un recordatorio puntual.
 */
function enviarPorCorreo(pool, opciones = {}) {
  return enFila(() => enviarPorCorreoAhora(pool, opciones));
}
async function enviarPorCorreoAhora(pool, { soloId = null } = {}) {
  if (!proveedorActivo()) return 0;
  const request = pool.request();
  if (soloId) request.input('soloId', sql.Int, soloId);
  const pendientes = (await request.query(consultaQueTocan(`
      AND pr.CorreoElectronico IS NOT NULL
      AND r.IntentosCorreo < ${MAX_INTENTOS_CORREO}  -- tras varios fallos ya no se reintenta (la app igual lo recibe)
      AND (r.EnviarPor IS NULL OR r.EnviarPor IN ('Correo', 'Ambos'))
      AND (r.CanalEnvio IS NULL OR CHARINDEX('Correo', r.CanalEnvio) = 0)
      ${soloId ? 'AND r.RecordatorioID = @soloId' : ''}`))).recordset;

  let enviados = 0;
  for (const r of pendientes) {
    const { titulo, cuerpo } = textoRecordatorio(r);
    const envio = await enviarCorreo({
      para: r.CorreoElectronico,
      // los recordatorios automáticos empiezan con un emoji; el asunto va sin él
      asunto: (r.TipoRecordatorio === 'Aviso' ? titulo : titulo.replace(/^\S+\s/, '')) + ' — Premier Can',
      html: plantillaCorreo({
        titulo: escaparHtml(titulo),
        contenido: `<p>Hola ${escaparHtml(r.PropietarioNombres)},</p><p>${escaparHtml(cuerpo).replace(/\n/g, '<br>')}</p>`,
      }),
    });
    if (envio.enviado) {
      await marcarEnviado(pool, r.RecordatorioID, 'Correo');
      enviados++;
    } else {
      // Fallo (correo inválido, cupo de Gmail agotado...): se cuenta el intento
      await pool.request().input('id', sql.Int, r.RecordatorioID)
        .query('UPDATE Recordatorios SET IntentosCorreo = IntentosCorreo + 1 WHERE RecordatorioID = @id');
    }
  }
  return enviados;
}

/** Recordatorios que la app del cliente todavía no mostró. */
async function pendientesParaApp(pool, propietarioId) {
  const filas = (await pool.request()
    .input('propietarioId', sql.Int, propietarioId)
    .query(consultaQueTocan(`
      AND pr.PropietarioID = @propietarioId
      AND (r.EnviarPor IS NULL OR r.EnviarPor IN ('App', 'Ambos'))
      AND (r.CanalEnvio IS NULL OR CHARINDEX('App', r.CanalEnvio) = 0)`))).recordset;
  return filas.map((r) => ({
    recordatorioId: r.RecordatorioID,
    tipo: r.TipoRecordatorio,
    // pacienteId: la app instalada antes de los avisos arma el id con esto
    // (para un aviso general se usa una mascota del dueño y abre su ficha)
    pacienteId: r.PacienteIDApp,
    idNotificacion: idNotificacion(r),
    ...textoRecordatorio(r),
  }));
}

/** La app confirma que mostró estos recordatorios (solo los del propio dueño). */
async function confirmarEnApp(pool, propietarioId, ids) {
  const validos = (ids || []).map(Number).filter(Number.isInteger).slice(0, 50);
  let confirmados = 0;
  for (const id of validos) {
    const propio = await pool.request()
      .input('id', sql.Int, id).input('propietarioId', sql.Int, propietarioId)
      .query("SELECT 1 FROM Recordatorios WHERE RecordatorioID = @id AND PropietarioID = @propietarioId AND Destino = 'Cliente'");
    if (propio.recordset.length) {
      await marcarEnviado(pool, id, 'App');
      confirmados++;
    }
  }
  return confirmados;
}

// ------------------------------------------------------------------
// Avisos personalizados (pantalla Recordatorios -> "Nueva notificación")
// ------------------------------------------------------------------

// A quién le llega: 'uno' (un dueño), 'todos', 'perros' o 'gatos' (dueños con
// al menos una mascota activa de esa especie). Solo dueños con la cuenta activa.
function filtroDestinatarios(destinatarios) {
  if (destinatarios === 'uno') return 'pr.PropietarioID = @propietarioId';
  if (destinatarios === 'perros' || destinatarios === 'gatos') {
    return `EXISTS (SELECT 1 FROM Pacientes px WHERE px.PropietarioID = pr.PropietarioID
                      AND px.Activo = 1 AND px.Especie = '${destinatarios === 'perros' ? 'Canino' : 'Felino'}')`;
  }
  return '1 = 1'; // todos
}

/** Cuántos dueños recibirían el aviso, y cuántos tienen app y correo. */
async function alcanceAvisos(pool, { destinatarios, propietarioId }) {
  const r = await pool.request()
    .input('propietarioId', sql.Int, propietarioId || null)
    .query(`
      SELECT COUNT(*) AS Total,
             SUM(CASE WHEN pr.ContrasenaHash IS NOT NULL THEN 1 ELSE 0 END) AS ConApp,
             SUM(CASE WHEN pr.CorreoElectronico IS NOT NULL THEN 1 ELSE 0 END) AS ConCorreo
      FROM Propietarios pr
      WHERE pr.Activo = 1 AND ${filtroDestinatarios(destinatarios)}
    `);
  const { Total, ConApp, ConCorreo } = r.recordset[0];
  return { total: Total || 0, conApp: ConApp || 0, conCorreo: ConCorreo || 0 };
}

/**
 * Crea el aviso (una fila por dueño). enviarEn: 'YYYY-MM-DDTHH:mm' hora de Perú,
 * o null para enviarlo ya. Si es ya, el correo sale en este mismo momento.
 */
async function crearAvisos(pool, { destinatarios, propietarioId, titulo, mensaje, enviarPor, enviarEn }) {
  const request = pool.request()
    .input('propietarioId', sql.Int, propietarioId || null)
    .input('titulo', sql.NVarChar(120), titulo)
    .input('mensaje', sql.NVarChar(300), mensaje)
    .input('enviarPor', sql.NVarChar(10), enviarPor)
    // SQL Server necesita los segundos para convertir el formato ISO ('...T10:30' falla)
    .input('enviarEn', sql.VarChar(19), enviarEn ? `${enviarEn.slice(0, 16)}:00` : null);
  const result = await request.query(`
    DECLARE @cuando DATETIME2 = ISNULL(CONVERT(DATETIME2, @enviarEn), ${AHORA_LIMA});
    INSERT INTO Recordatorios (PacienteID, PropietarioID, TipoRecordatorio, FechaProgramada, Canal, Estado,
                               Mensaje, Titulo, Destino, EnviarPor, EnviarDesde)
    SELECT NULL, pr.PropietarioID, 'Aviso', @cuando, 'Push', 'Pendiente',
           @mensaje, @titulo, 'Cliente', @enviarPor, @cuando
    FROM Propietarios pr
    WHERE pr.Activo = 1 AND ${filtroDestinatarios(destinatarios)}
  `);
  const creados = result.rowsAffected[result.rowsAffected.length - 1] || 0;
  // Los correos salen en segundo plano: con muchos destinatarios, esperar a que
  // Gmail acepte uno por uno dejaría la pantalla colgada varios minutos.
  if (!enviarEn && creados) {
    enviarPorCorreo(pool).catch((err) => console.error('Error enviando correos del aviso:', err.message));
  }
  return { creados };
}

/**
 * "Enviar ahora": manda YA un recordatorio pendiente (correo al instante; la app
 * lo muestra en su próxima revisión, o apenas el cliente la abra).
 */
async function enviarAhora(pool, recordatorioId) {
  const r = await pool.request().input('id', sql.Int, recordatorioId).query(`
    UPDATE Recordatorios SET EnviarDesde = ${AHORA_LIMA}, Estado = 'Pendiente'
    OUTPUT INSERTED.Destino, INSERTED.EnviarPor
    WHERE RecordatorioID = @id AND Estado = 'Pendiente' AND Destino = 'Cliente'
  `);
  if (!r.recordset.length) return null;
  const porCorreo = await enviarPorCorreo(pool, { soloId: recordatorioId });
  const { EnviarPor } = r.recordset[0];
  return { porCorreo: porCorreo > 0, porApp: EnviarPor !== 'Correo' };
}

/** "Ya avisé por teléfono": queda como avisado a mano y el sistema ya no lo envía. */
async function marcarAvisadoManual(pool, recordatorioId) {
  await marcarEnviado(pool, recordatorioId, 'Manual');
}

/** Número de soporte con espacios para que se lea fácil: 947 051 545 */
function telefonoSoporte() {
  const num = String(process.env.SOPORTE_TELEFONO || '947051545').replace(/\D/g, '');
  return num.length === 9 ? `${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}` : num;
}

/**
 * Bienvenida automática: la PRIMERA vez que el cliente inicia sesión se le
 * manda un aviso (app + correo) con el número de soporte. La marca se pone en
 * la misma sentencia que la comprueba, así nunca llega dos veces aunque entre
 * desde dos lugares a la vez.
 */
async function enviarBienvenidaSiEsPrimeraVez(pool, propietario) {
  const marca = await pool.request().input('id', sql.Int, propietario.PropietarioID).query(`
    UPDATE Propietarios SET BienvenidaEnviada = 1
    WHERE PropietarioID = @id AND BienvenidaEnviada = 0
  `);
  if (!marca.rowsAffected[0]) return false;

  const nombre = String(propietario.Nombres || '').trim().split(/\s+/)[0] || '';
  await crearAvisos(pool, {
    destinatarios: 'uno',
    propietarioId: propietario.PropietarioID,
    titulo: `🐾 ¡Te damos la bienvenida a Premier Can${nombre ? `, ${nombre}` : ''}!`,
    mensaje: 'Gracias por confiar en nosotros. Desde aquí verás a tus mascotas, sus vacunas y tus citas, y te avisaremos de todo lo importante.\n'
      + `¿Dudas? Escríbenos o llámanos al ${telefonoSoporte()}.`,
    enviarPor: 'Ambos',
    enviarEn: null,
  });
  return true;
}

let corriendo = false;
async function ejecutarCiclo() {
  if (corriendo) return; // si el ciclo anterior sigue, no se pisan
  corriendo = true;
  try {
    const pool = await getPool();
    await actualizarEstadosEsquemas(pool); // vacunas vencidas pasan a "Atrasado"
    const creados = await generarRecordatorios(pool);
    const correos = await enviarPorCorreo(pool);
    if (creados || correos) console.log(`🔔 Recordatorios: ${creados} nuevo(s), ${correos} enviado(s) por correo.`);
  } catch (err) {
    console.error('Error en la tarea automática de recordatorios:', err.message);
  } finally {
    corriendo = false;
  }
}

function iniciarTareaProgramada(minutos = 15) {
  ejecutarCiclo();
  return setInterval(ejecutarCiclo, minutos * 60 * 1000);
}

module.exports = {
  generarRecordatorios, enviarPorCorreo, pendientesParaApp, confirmarEnApp,
  textoRecordatorio, iniciarTareaProgramada, TIPO_ESQUEMA_A_RECORDATORIO,
  alcanceAvisos, crearAvisos, enviarAhora, marcarAvisadoManual, enviarBienvenidaSiEsPrimeraVez,
};
