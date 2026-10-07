// utils/estadoEsquemas.js
// Recalcula EsquemasPreventivos.Estado con la fecha de HOY en Perú.
//
// Antes el estado se calculaba una sola vez al guardar y nunca cambiaba: una
// vacuna aplicada quedaba "AlDia" para siempre aunque el refuerzo venciera, y
// la cobertura de Reportes salía ~100%. Ahora se recalcula al arrancar, cada
// 15 minutos (recordatorios-auto.js) y antes de Reportes / Dashboard.
//
// Reglas (las mismas que calcularEstado() en esquemas.controller.js):
//  - Dosis aplicada que ya tiene una dosis POSTERIOR aplicada (mismo paciente,
//    tipo y producto): es historial -> AlDia.
//  - Si no: refuerzo vencido -> Atrasado; vence en ≤30 días -> Pendiente; si no, AlDia.
//  - Dosis pendiente (aún no aplicada): vencida -> Atrasado; si no -> Pendiente.
const HOY_LIMA = 'CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE)';

async function actualizarEstadosEsquemas(pool) {
  const r = await pool.request().query(`
    UPDATE e SET e.Estado = x.Nuevo
    FROM EsquemasPreventivos e
    CROSS APPLY (SELECT CASE
      WHEN e.FechaAplicacion IS NOT NULL AND EXISTS (
             SELECT 1 FROM EsquemasPreventivos s
             WHERE s.PacienteID = e.PacienteID AND s.TipoEsquemaID = e.TipoEsquemaID
               AND s.NombreProducto = e.NombreProducto
               AND s.FechaAplicacion > e.FechaAplicacion)            THEN 'AlDia'
      WHEN e.FechaProximaDosis IS NULL
           THEN CASE WHEN e.FechaAplicacion IS NULL THEN 'Pendiente' ELSE 'AlDia' END
      WHEN e.FechaProximaDosis < ${HOY_LIMA}                          THEN 'Atrasado'
      WHEN e.FechaAplicacion IS NULL                                   THEN 'Pendiente'
      WHEN DATEDIFF(DAY, ${HOY_LIMA}, e.FechaProximaDosis) <= 30       THEN 'Pendiente'
      ELSE 'AlDia' END AS Nuevo) x
    WHERE e.Estado <> x.Nuevo
  `);
  return r.rowsAffected[0] || 0;
}

module.exports = { actualizarEstadosEsquemas, HOY_LIMA };
