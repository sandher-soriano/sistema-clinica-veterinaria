// utils/lotes.js
// Stock por lote (tabla LotesInventario). Reglas:
//  - Cada entrada crea un lote (número, vencimiento, costo).
//  - Cada salida descuenta primero del lote que vence antes (FEFO); los lotes
//    sin fecha van al final. Se guarda de qué lote salió (LotesSalidas) para
//    devolverlo exacto si se anula.
//  - Medicamentos.Lote / FechaVencimiento muestran el lote "en uso": el próximo
//    a vencer que todavía tiene unidades. Así las alertas de vencimiento son reales.
// Todas las funciones reciben la transacción (tx) de quien llama.
const { sql } = require('../config/db');

const req = (tx) => new sql.Request(tx);

/** Lote "en uso" -> Medicamentos.Lote / FechaVencimiento */
async function refrescarResumen(tx, medicamentoId) {
  await req(tx).input('id', sql.Int, medicamentoId).query(`
    IF EXISTS (SELECT 1 FROM LotesInventario WHERE MedicamentoID = @id)
      UPDATE m SET Lote = l.NumeroLote, FechaVencimiento = l.FechaVencimiento
      FROM Medicamentos m
      OUTER APPLY (SELECT TOP 1 NumeroLote, FechaVencimiento FROM LotesInventario
                   WHERE MedicamentoID = @id AND CantidadActual > 0
                   ORDER BY CASE WHEN FechaVencimiento IS NULL THEN 1 ELSE 0 END, FechaVencimiento, LoteID) l
      WHERE m.MedicamentoID = @id`);
}

/** Crea un lote con unidades nuevas. Devuelve el LoteID. (El stock total lo sube quien llama.) */
async function entradaLote(tx, { medicamentoId, cantidad, numeroLote = null, fechaVencimiento = null, costo = null, compraId = null, origen = 'Entrada' }) {
  const r = await req(tx)
    .input('id', sql.Int, medicamentoId).input('lote', sql.NVarChar(40), numeroLote || null).input('vence', sql.Date, fechaVencimiento || null)
    .input('c', sql.Decimal(10, 2), cantidad).input('costo', sql.Decimal(10, 2), costo).input('compra', sql.Int, compraId).input('origen', sql.NVarChar(20), origen)
    .query(`INSERT INTO LotesInventario (MedicamentoID, NumeroLote, FechaVencimiento, CantidadInicial, CantidadActual, CostoUnitario, CompraID, Origen)
            OUTPUT INSERTED.LoteID VALUES (@id, @lote, @vence, @c, @c, @costo, @compra, @origen)`);
  await refrescarResumen(tx, medicamentoId);
  return r.recordset[0].LoteID;
}

/**
 * Descuenta "cantidad" de los lotes (FEFO) y registra de dónde salió.
 * vinculo: { pagoDetalleId } o { movimientoId }.
 * Si los lotes no alcanzan (datos antiguos sin lote), lo que falta sale "sin lote".
 */
async function salidaFEFO(tx, medicamentoId, cantidad, vinculo = {}) {
  const lotes = (await req(tx).input('id', sql.Int, medicamentoId).query(`
    SELECT LoteID, CantidadActual FROM LotesInventario WITH (UPDLOCK, ROWLOCK)
    WHERE MedicamentoID = @id AND CantidadActual > 0
    ORDER BY CASE WHEN FechaVencimiento IS NULL THEN 1 ELSE 0 END, FechaVencimiento, LoteID`)).recordset;
  let falta = Number(cantidad);
  const usados = [];
  for (const l of lotes) {
    if (falta <= 0) break;
    const toma = Math.min(falta, Number(l.CantidadActual));
    await req(tx).input('l', sql.Int, l.LoteID).input('c', sql.Decimal(10, 2), toma)
      .query('UPDATE LotesInventario SET CantidadActual = CantidadActual - @c WHERE LoteID = @l');
    await req(tx).input('l', sql.Int, l.LoteID).input('c', sql.Decimal(10, 2), toma)
      .input('pd', sql.Int, vinculo.pagoDetalleId || null).input('mv', sql.Int, vinculo.movimientoId || null)
      .query('INSERT INTO LotesSalidas (LoteID, Cantidad, PagoDetalleID, MovimientoID) VALUES (@l, @c, @pd, @mv)');
    usados.push({ loteId: l.LoteID, cantidad: toma });
    falta = Math.round((falta - toma) * 100) / 100;
  }
  await refrescarResumen(tx, medicamentoId);
  return usados;
}

/** Devuelve a sus lotes lo que salió por un detalle de cobro (anulación). Devuelve lo que quedó sin lote. */
async function devolverDePago(tx, pagoDetalleId, medicamentoId, cantidadTotal) {
  const salidas = (await req(tx).input('pd', sql.Int, pagoDetalleId)
    .query('SELECT LoteID, Cantidad FROM LotesSalidas WHERE PagoDetalleID = @pd')).recordset;
  let devuelto = 0;
  for (const s of salidas) {
    await req(tx).input('l', sql.Int, s.LoteID).input('c', sql.Decimal(10, 2), s.Cantidad)
      .query('UPDATE LotesInventario SET CantidadActual = CantidadActual + @c WHERE LoteID = @l');
    devuelto += Number(s.Cantidad);
  }
  const resto = Math.round((Number(cantidadTotal) - devuelto) * 100) / 100;
  if (resto > 0) await entradaLote(tx, { medicamentoId, cantidad: resto, origen: 'Ajuste' });
  else await refrescarResumen(tx, medicamentoId);
}

module.exports = { entradaLote, salidaFEFO, devolverDePago, refrescarResumen };
