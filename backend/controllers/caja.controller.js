// controllers/caja.controller.js
// Caja diaria como punto de venta.
//  - Un cobro tiene ÍTEMS: servicios (Tarifas), productos del inventario (descuentan
//    stock) y conceptos libres.
//  - Descuentos: una promoción vigente (se calcula aquí, nunca se confía en el
//    monto que manda la pantalla) o un descuento manual con motivo (> 30 %: solo
//    Administrativo). No se combinan.
//  - Las consultas de la historia clínica sin cobrar aparecen como "Por cobrar"
//    con su servicio y los medicamentos recetados; una consulta se cobra una vez.
//  - Un cobro nunca se borra: se ANULA con motivo y el stock vuelve al inventario.
//  - Al cerrar la caja del día ya no se admiten cobros ni anulaciones de ese día.
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { GRUPO_INVENTARIO, reglaPromocion, descuentoDePromocion, descuentoManual, repartirPromocion, redondear, aplicaATodo } = require('../utils/precios');
const { salidaFEFO, devolverDePago } = require('../utils/lotes');

const METODOS = ['Efectivo', 'Tarjeta', 'Yape', 'Plin'];
const MAX_DESCUENTO_SIN_ADMIN = 30; // %
const HOY_LIMA = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const HOY_SQL = 'CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE)';

async function totalesDelDia(pool, fecha) {
  const r = await pool.request().input('f', sql.Date, fecha).query(`
    SELECT MetodoPago, SUM(Monto) AS Total, COUNT(*) AS Cantidad, SUM(Descuento) AS Descuentos
    FROM Pagos WHERE CAST(Fecha AS DATE) = @f AND Anulado = 0 GROUP BY MetodoPago`);
  const t = { Efectivo: 0, Tarjeta: 0, Yape: 0, Plin: 0, total: 0, cantidad: 0, descuentos: 0 };
  r.recordset.forEach((x) => { t[x.MetodoPago] = Number(x.Total); t.total += Number(x.Total); t.cantidad += x.Cantidad; t.descuentos += Number(x.Descuentos || 0); });
  t.total = redondear(t.total); t.descuentos = redondear(t.descuentos);
  return t;
}

async function cierreDe(pool, fecha) {
  const r = await pool.request().input('f', sql.Date, fecha).query(`
    SELECT c.*, (per.Nombres + ' ' + per.Apellidos) AS CerradoPor
    FROM CierresCaja c INNER JOIN Usuarios u ON u.UsuarioID = c.UsuarioID INNER JOIN Personas per ON per.PersonaID = u.PersonaID
    WHERE c.Fecha = @f`);
  return r.recordset[0] || null;
}

async function promocionesVigentes(pool) {
  const r = await pool.request().query(`
    SELECT PromocionID, Titulo, Etiqueta, Categoria, PrecioRegular, PrecioPromocion, DescuentoTipo, DescuentoValor, FechaFin
    FROM Promociones WHERE Activo = 1 AND ${HOY_SQL} BETWEEN FechaInicio AND FechaFin ORDER BY FechaFin`);
  return r.recordset.map((p) => ({ ...p, Regla: reglaPromocion(p) }));
}

// ------------------------------------------------------------------
// GET /api/caja?fecha=YYYY-MM-DD  (por defecto hoy) — cobros con su detalle
// ------------------------------------------------------------------
async function delDia(req, res) {
  const fecha = fechaValida(req.query.fecha) ? req.query.fecha : HOY_LIMA();
  try {
    const pool = await getPool();
    const pagos = (await pool.request().input('f', sql.Date, fecha).query(`
      SELECT pg.PagoID, pg.Fecha, pg.Monto, pg.Subtotal, pg.Descuento, pg.MotivoDescuento, pg.MetodoPago, pg.Concepto,
             pg.Anulado, pg.MotivoAnulacion, pg.CitaID, pg.ConsultaID, pr.Titulo AS PromocionTitulo,
             p.Nombre AS PacienteNombre, (per.Nombres + ' ' + per.Apellidos) AS Usuario
      FROM Pagos pg
      LEFT JOIN Pacientes p ON p.PacienteID = pg.PacienteID
      LEFT JOIN Promociones pr ON pr.PromocionID = pg.PromocionID
      INNER JOIN Usuarios u ON u.UsuarioID = pg.UsuarioID INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      WHERE CAST(pg.Fecha AS DATE) = @f ORDER BY pg.Fecha DESC`)).recordset;
    if (pagos.length) {
      const det = (await pool.request().input('f', sql.Date, fecha).query(`
        SELECT d.PagoID, d.Descripcion, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.Tipo, d.Descuento, d.DescuentoPromo
        FROM PagosDetalle d INNER JOIN Pagos pg ON pg.PagoID = d.PagoID
        WHERE CAST(pg.Fecha AS DATE) = @f ORDER BY d.DetalleID`)).recordset;
      pagos.forEach((p) => { p.Detalle = det.filter((d) => d.PagoID === p.PagoID); });
    }
    res.json({ fecha, esHoy: fecha === HOY_LIMA(), pagos, totales: await totalesDelDia(pool, fecha), cierre: await cierreDe(pool, fecha) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar la caja.' });
  }
}

// ------------------------------------------------------------------
// GET /api/caja/catalogo — tarifas, productos y promociones vigentes
// ------------------------------------------------------------------
async function catalogo(req, res) {
  try {
    const pool = await getPool();
    const tarifas = (await pool.request().query('SELECT TarifaID, Nombre, Grupo, TipoCita, Precio, Activo FROM Tarifas ORDER BY Activo DESC, Nombre')).recordset;
    const productos = (await pool.request().query(`
      SELECT MedicamentoID, NombreMedicamento, Categoria, Unidad, Stock, ControlStock, PrecioVenta
      FROM Medicamentos WHERE Activo = 1 ORDER BY NombreMedicamento`)).recordset
      .map((m) => ({ ...m, Grupo: GRUPO_INVENTARIO[m.Categoria] || 'Tienda' }));
    res.json({ tarifas, productos, promociones: await promocionesVigentes(pool), maxDescuentoSinAdmin: MAX_DESCUENTO_SIN_ADMIN });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar el catálogo de caja.' });
  }
}

// ------------------------------------------------------------------
// GET /api/caja/pendientes — consultas sin cobrar (últimos 60 días), con
// los ítems sugeridos: el servicio (según el tipo de cita) y los medicamentos
// recetados en la historia clínica.
// ------------------------------------------------------------------
async function pendientes(req, res) {
  try {
    const pool = await getPool();
    const consultas = (await pool.request().query(`
      SELECT c.ConsultaID, c.FechaConsulta, c.MotivoConsulta, c.CitaID, ci.TipoCita, ci.MetodoPago,
             p.PacienteID, p.Nombre AS PacienteNombre, pr.Nombres AS PropietarioNombres, pr.Apellidos AS PropietarioApellidos
      FROM Consultas c
      INNER JOIN Pacientes p ON p.PacienteID = c.PacienteID
      INNER JOIN Propietarios pr ON pr.PropietarioID = p.PropietarioID
      LEFT JOIN Citas ci ON ci.CitaID = c.CitaID
      WHERE c.FechaConsulta >= DATEADD(DAY, -60, ${HOY_SQL})
        AND NOT EXISTS (SELECT 1 FROM Pagos pg WHERE pg.ConsultaID = c.ConsultaID AND pg.Anulado = 0)
      ORDER BY c.FechaConsulta DESC, c.ConsultaID DESC`)).recordset;
    if (!consultas.length) return res.json([]);

    const tarifas = (await pool.request().query('SELECT TarifaID, Nombre, Grupo, TipoCita, Precio FROM Tarifas WHERE Activo = 1')).recordset;
    const consultaGeneral = tarifas.find((t) => t.TipoCita === 'Consulta') || tarifas[0];
    const meds = (await pool.request().query(`
      SELECT cm.ConsultaID, m.MedicamentoID, m.NombreMedicamento, m.Categoria, m.PrecioVenta, m.Stock, m.ControlStock, m.Unidad,
             cm.Dosis, cm.Frecuencia, cm.DuracionDias
      FROM ConsultaMedicamentos cm INNER JOIN Medicamentos m ON m.MedicamentoID = cm.MedicamentoID
      WHERE cm.ConsultaID IN (${consultas.map((c) => Number(c.ConsultaID)).join(',')})
      ORDER BY cm.ConsultaMedicamentoID`)).recordset;

    res.json(consultas.map((c) => {
      const servicio = tarifas.find((t) => t.TipoCita && t.TipoCita === c.TipoCita) || consultaGeneral;
      const items = [];
      if (servicio) items.push({ tipo: 'Servicio', tarifaId: servicio.TarifaID, descripcion: servicio.Nombre, grupo: servicio.Grupo, cantidad: 1, precioUnitario: Number(servicio.Precio) });
      meds.filter((m) => m.ConsultaID === c.ConsultaID).forEach((m) => items.push({
        tipo: 'Producto', medicamentoId: m.MedicamentoID, descripcion: m.NombreMedicamento, grupo: GRUPO_INVENTARIO[m.Categoria] || 'Tienda',
        cantidad: 1, precioUnitario: m.PrecioVenta != null ? Number(m.PrecioVenta) : 0, sinPrecio: m.PrecioVenta == null,
        stock: Number(m.Stock), controlStock: !!m.ControlStock, unidad: m.Unidad,
        indicacion: [m.Dosis, m.Frecuencia, m.DuracionDias && `${m.DuracionDias} días`].filter(Boolean).join(' · '),
      }));
      return { ...c, items };
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron cargar las consultas por cobrar.' });
  }
}

// ------------------------------------------------------------------
// POST /api/caja/pagos
// { items: [{ tipo, tarifaId?, medicamentoId?, descripcion, cantidad, precioUnitario }],
//   metodoPago, promocionId?, descuentoManual?: { tipo: 'Porcentaje'|'Monto', valor, motivo },
//   consultaId?, citaId?, pacienteId? }
// (Compatibilidad: { concepto, monto } sin ítems = un concepto libre.)
// ------------------------------------------------------------------
async function cobrar(req, res) {
  const b = req.body || {};
  const metodo = b.metodoPago;
  if (!METODOS.includes(metodo)) return res.status(400).json({ mensaje: 'Elige el método de pago.' });

  let entrada = Array.isArray(b.items) ? b.items : [];
  if (!entrada.length && b.concepto) entrada = [{ tipo: 'Libre', descripcion: b.concepto, cantidad: 1, precioUnitario: b.monto }];
  if (!entrada.length) return res.status(400).json({ mensaje: 'Agrega al menos un ítem al cobro.' });
  if (entrada.length > 50) return res.status(400).json({ mensaje: 'Demasiados ítems en un solo cobro.' });

  const pool = await getPool();
  if (await cierreDe(pool, HOY_LIMA())) return res.status(400).json({ mensaje: 'La caja de hoy ya está cerrada: no se pueden registrar más cobros hoy.' });

  // --- Ítems validados contra la base (grupo y existencia salen de la BD) ---
  const items = [];
  for (const it of entrada) {
    const cantidad = redondear(it.cantidad);
    const precio = redondear(it.precioUnitario);
    if (!(cantidad > 0 && cantidad <= 1000)) return res.status(400).json({ mensaje: 'Cada ítem necesita una cantidad válida.' });
    if (!(precio >= 0 && precio < 100000)) return res.status(400).json({ mensaje: 'Cada ítem necesita un precio válido.' });
    let item = { tipo: 'Libre', descripcion: String(it.descripcion || '').trim().slice(0, 150), grupo: null, cantidad, precioUnitario: precio };
    if (it.tipo === 'Servicio' && it.tarifaId) {
      const t = (await pool.request().input('id', sql.Int, it.tarifaId).query('SELECT TarifaID, Nombre, Grupo FROM Tarifas WHERE TarifaID = @id')).recordset[0];
      if (!t) return res.status(400).json({ mensaje: 'Un servicio del cobro no existe.' });
      item = { ...item, tipo: 'Servicio', tarifaId: t.TarifaID, descripcion: item.descripcion || t.Nombre, grupo: t.Grupo };
    } else if (it.tipo === 'Producto' && it.medicamentoId) {
      const m = (await pool.request().input('id', sql.Int, it.medicamentoId).query('SELECT MedicamentoID, NombreMedicamento, Categoria, ControlStock FROM Medicamentos WHERE MedicamentoID = @id AND Activo = 1')).recordset[0];
      if (!m) return res.status(400).json({ mensaje: 'Un producto del cobro no existe en el inventario.' });
      item = { ...item, tipo: 'Producto', medicamentoId: m.MedicamentoID, descripcion: m.NombreMedicamento, grupo: GRUPO_INVENTARIO[m.Categoria] || 'Tienda', controlStock: !!m.ControlStock };
    }
    if (!item.descripcion) return res.status(400).json({ mensaje: 'Cada ítem necesita una descripción.' });
    item.subtotal = redondear(cantidad * precio);
    // Descuento manual de ESTE ítem (opcional)
    if (it.descuento) {
      const d = it.descuento;
      if (!['Porcentaje', 'Monto'].includes(d.tipo) || !(Number(d.valor) > 0)) return res.status(400).json({ mensaje: `El descuento de "${item.descripcion}" no es válido.` });
      item.descuento = descuentoManual(item.subtotal, d);
    } else item.descuento = 0;
    item.descuentoPromo = 0;
    items.push(item);
  }
  const subtotal = redondear(items.reduce((s, i) => s + i.subtotal, 0));
  const usuarioEsAdmin = !!req.usuario.accesoConfig;
  const limite = (pct) => pct > MAX_DESCUENTO_SIN_ADMIN + 0.001 && !usuarioEsAdmin;
  const MSJ_LIMITE = `Un descuento mayor al ${MAX_DESCUENTO_SIN_ADMIN}% solo lo puede autorizar el personal administrativo.`;

  // --- Descuentos ---
  //  · por producto: cada ítem el suyo (con motivo)
  //  · promoción: solo los ítems de su categoría que NO tienen descuento propio
  //  · a todo el cobro: no se combina con los anteriores
  let promocionId = null; let promoTitulo = null; let descuentoGeneral = 0;
  const conDescItem = items.filter((i) => i.descuento > 0);
  const hayManual = conDescItem.length > 0 || !!b.descuentoManual;
  const motivoDescuento = hayManual ? String(b.motivoDescuento || (b.descuentoManual && b.descuentoManual.motivo) || '').trim().slice(0, 200) : null;
  if (hayManual && !motivoDescuento) return res.status(400).json({ mensaje: 'Indica el motivo del descuento.' });
  if (b.descuentoManual && (b.promocionId || conDescItem.length)) return res.status(400).json({ mensaje: 'El descuento a todo el cobro no se combina con promociones ni con descuentos por producto.' });
  for (const i of conDescItem) {
    if (limite((i.descuento / i.subtotal) * 100)) return res.status(403).json({ mensaje: `${MSJ_LIMITE} (en "${i.descripcion}")` });
  }
  if (b.promocionId) {
    const promo = (await promocionesVigentes(pool)).find((p) => p.PromocionID === Number(b.promocionId));
    if (!promo) return res.status(400).json({ mensaje: 'Esa promoción no está vigente.' });
    const sinDesc = (i) => !(i.descuento > 0);
    const r = descuentoDePromocion(items.filter(sinDesc), promo);
    if (!r.regla) return res.status(400).json({ mensaje: 'Esa promoción no tiene un descuento que se pueda aplicar en caja.' });
    if (r.descuento <= 0) return res.status(400).json({ mensaje: `La promoción "${promo.Titulo}" no aplica a estos ítems (es de ${promo.Categoria || 'otra categoría'}, o ya tienen su propio descuento).` });
    const cubre = (i) => sinDesc(i) && (aplicaATodo(promo) || i.grupo === promo.Categoria);
    repartirPromocion(items, cubre, r.descuento).forEach((parte, k) => { items[k].descuentoPromo = parte; });
    promocionId = promo.PromocionID; promoTitulo = promo.Titulo;
  } else if (b.descuentoManual) {
    const d = b.descuentoManual;
    if (!['Porcentaje', 'Monto'].includes(d.tipo) || !(Number(d.valor) > 0)) return res.status(400).json({ mensaje: 'Indica un descuento válido.' });
    descuentoGeneral = descuentoManual(subtotal, d);
    if (limite(subtotal > 0 ? (descuentoGeneral / subtotal) * 100 : 0)) return res.status(403).json({ mensaje: MSJ_LIMITE });
  }
  const descItems = redondear(items.reduce((s, i) => s + i.descuento, 0));
  const descPromo = redondear(items.reduce((s, i) => s + i.descuentoPromo, 0));
  const descuento = redondear(descItems + descPromo + descuentoGeneral);
  const total = redondear(subtotal - descuento);
  if (!(total > 0)) return res.status(400).json({ mensaje: 'El total a cobrar debe ser mayor que cero.' });

  const concepto = (items.length === 1 ? items[0].descripcion : `${items[0].descripcion} + ${items.length - 1} más`).slice(0, 150);
  const consultaId = b.consultaId ? Number(b.consultaId) : null;

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    let pacienteId = b.pacienteId ? Number(b.pacienteId) : null;
    if (consultaId) {
      const c = (await new sql.Request(tx).input('id', sql.Int, consultaId).query('SELECT PacienteID FROM Consultas WHERE ConsultaID = @id')).recordset[0];
      if (!c) { await tx.rollback(); return res.status(400).json({ mensaje: 'Esa consulta no existe.' }); }
      pacienteId = c.PacienteID;
    }
    const ins = await new sql.Request(tx)
      .input('monto', sql.Decimal(10, 2), total).input('subtotal', sql.Decimal(10, 2), subtotal).input('descuento', sql.Decimal(10, 2), descuento)
      .input('metodo', sql.NVarChar, metodo).input('concepto', sql.NVarChar, concepto)
      .input('pacienteId', sql.Int, pacienteId).input('citaId', sql.Int, b.citaId ? Number(b.citaId) : null).input('consultaId', sql.Int, consultaId)
      .input('promocionId', sql.Int, promocionId).input('motivo', sql.NVarChar, motivoDescuento).input('u', sql.Int, req.usuario.usuarioId)
      .query(`INSERT INTO Pagos (Monto, Subtotal, Descuento, MetodoPago, Concepto, PacienteID, CitaID, ConsultaID, PromocionID, MotivoDescuento, UsuarioID)
              OUTPUT INSERTED.PagoID
              VALUES (@monto, @subtotal, @descuento, @metodo, @concepto, @pacienteId, @citaId, @consultaId, @promocionId, @motivo, @u)`);
    const pagoId = ins.recordset[0].PagoID;

    for (const it of items) {
      let stockResultante = null;
      if (it.tipo === 'Producto' && it.controlStock) {
        // Venta con control de stock: se descuenta de forma atómica (sin quedar negativo)
        const s = await new sql.Request(tx).input('id', sql.Int, it.medicamentoId).input('c', sql.Decimal(10, 2), it.cantidad)
          .query('UPDATE Medicamentos SET Stock = Stock - @c OUTPUT INSERTED.Stock, INSERTED.Unidad WHERE MedicamentoID = @id AND Stock >= @c');
        if (!s.recordset.length) {
          await tx.rollback();
          return res.status(400).json({ mensaje: `No hay stock suficiente de "${it.descripcion}". Ajusta la cantidad o registra la entrada en Inventario.` });
        }
        stockResultante = s.recordset[0].Stock;
      }
      const det = await new sql.Request(tx)
        .input('pagoId', sql.Int, pagoId).input('tipo', sql.NVarChar, it.tipo).input('tarifaId', sql.Int, it.tarifaId || null)
        .input('medId', sql.Int, it.medicamentoId || null).input('desc', sql.NVarChar, it.descripcion).input('grupo', sql.NVarChar, it.grupo)
        .input('cant', sql.Decimal(10, 2), it.cantidad).input('precio', sql.Decimal(10, 2), it.precioUnitario).input('sub', sql.Decimal(10, 2), it.subtotal)
        .input('stock', sql.Bit, stockResultante !== null ? 1 : 0)
        .input('dItem', sql.Decimal(10, 2), it.descuento).input('dPromo', sql.Decimal(10, 2), it.descuentoPromo)
        .query(`INSERT INTO PagosDetalle (PagoID, Tipo, TarifaID, MedicamentoID, Descripcion, Grupo, Cantidad, PrecioUnitario, Subtotal, DescontoStock, Descuento, DescuentoPromo)
                OUTPUT INSERTED.DetalleID
                VALUES (@pagoId, @tipo, @tarifaId, @medId, @desc, @grupo, @cant, @precio, @sub, @stock, @dItem, @dPromo)`);
      if (stockResultante !== null) {
        // Sale del lote que vence antes (FEFO) y queda anotado para poder devolverlo
        await salidaFEFO(tx, it.medicamentoId, it.cantidad, { pagoDetalleId: det.recordset[0].DetalleID });
        await new sql.Request(tx).input('id', sql.Int, it.medicamentoId).input('c', sql.Decimal(10, 2), it.cantidad)
          .input('s', sql.Decimal(10, 2), stockResultante).input('m', sql.NVarChar, `Venta en caja (cobro #${pagoId})`).input('u', sql.Int, req.usuario.usuarioId)
          .query("INSERT INTO MovimientosInventario (MedicamentoID, Tipo, Cantidad, StockResultante, Motivo, UsuarioID) VALUES (@id, 'Salida', @c, @s, @m, @u)");
      }
    }
    await tx.commit();

    const partes = [];
    items.filter((i) => i.descuento > 0).forEach((i) => partes.push(`−S/ ${i.descuento.toFixed(2)} en ${i.descripcion}`));
    if (descPromo > 0) partes.push(`promoción "${promoTitulo}" −S/ ${descPromo.toFixed(2)}`);
    if (descuentoGeneral > 0) partes.push(`−S/ ${descuentoGeneral.toFixed(2)} a todo el cobro`);
    const textoDesc = descuento > 0 ? ` con descuento de S/ ${descuento.toFixed(2)} (${partes.join('; ')}${motivoDescuento ? ` · motivo: ${motivoDescuento}` : ''})` : '';
    await registrarAuditoria(pool, { tabla: 'Pagos', registroId: pagoId, accion: 'Cobrar', usuarioId: req.usuario.usuarioId,
      detalle: `Cobró S/ ${total.toFixed(2)} (${metodo}) por ${concepto}${textoDesc}${consultaId ? ` · consulta #${consultaId}` : ''}` });
    res.status(201).json({ mensaje: 'Cobro registrado.', pagoId, subtotal, descuento, total });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    if (err.number === 2601 || err.number === 2627) return res.status(409).json({ mensaje: 'Esa consulta ya fue cobrada.' });
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo registrar el cobro.' });
  }
}

// POST /api/caja/pagos/:id/anular  { motivo }   (Administrativo) — devuelve el stock
async function anular(req, res) {
  const motivo = String(req.body.motivo || '').trim().slice(0, 200);
  if (!motivo) return res.status(400).json({ mensaje: 'Indica el motivo de la anulación.' });
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    const p = (await pool.request().input('id', sql.Int, req.params.id).query('SELECT CAST(Fecha AS DATE) AS Dia, Monto, Concepto FROM Pagos WHERE PagoID = @id')).recordset[0];
    if (!p) return res.status(404).json({ mensaje: 'Cobro no encontrado.' });
    if (await cierreDe(pool, p.Dia.toISOString().slice(0, 10))) return res.status(400).json({ mensaje: 'Ese día ya tiene la caja cerrada: no se puede anular.' });
    await tx.begin();
    const r = await new sql.Request(tx).input('id', sql.Int, req.params.id).input('m', sql.NVarChar, motivo).input('u', sql.Int, req.usuario.usuarioId)
      .query('UPDATE Pagos SET Anulado = 1, MotivoAnulacion = @m, AnuladoPor = @u WHERE PagoID = @id AND Anulado = 0');
    if (!r.rowsAffected[0]) { await tx.rollback(); return res.status(400).json({ mensaje: 'Ese cobro ya estaba anulado.' }); }
    // Los productos que se descontaron vuelven al inventario
    const det = (await new sql.Request(tx).input('id', sql.Int, req.params.id).query('SELECT DetalleID, MedicamentoID, Cantidad FROM PagosDetalle WHERE PagoID = @id AND DescontoStock = 1')).recordset;
    for (const d of det) {
      await devolverDePago(tx, d.DetalleID, d.MedicamentoID, d.Cantidad);
      const s = await new sql.Request(tx).input('mid', sql.Int, d.MedicamentoID).input('c', sql.Decimal(10, 2), d.Cantidad)
        .query('UPDATE Medicamentos SET Stock = Stock + @c OUTPUT INSERTED.Stock WHERE MedicamentoID = @mid');
      await new sql.Request(tx).input('mid', sql.Int, d.MedicamentoID).input('c', sql.Decimal(10, 2), d.Cantidad).input('s', sql.Decimal(10, 2), s.recordset[0].Stock)
        .input('m', sql.NVarChar, `Anulación del cobro #${req.params.id}`).input('u', sql.Int, req.usuario.usuarioId)
        .query("INSERT INTO MovimientosInventario (MedicamentoID, Tipo, Cantidad, StockResultante, Motivo, UsuarioID) VALUES (@mid, 'Entrada', @c, @s, @m, @u)");
    }
    await tx.commit();
    await registrarAuditoria(pool, { tabla: 'Pagos', registroId: Number(req.params.id), accion: 'Anular', usuarioId: req.usuario.usuarioId,
      detalle: `Anuló cobro de S/ ${Number(p.Monto).toFixed(2)} (${p.Concepto}). Motivo: ${motivo}${det.length ? ` · ${det.length} producto(s) devuelto(s) al inventario` : ''}` });
    res.json({ mensaje: det.length ? 'Cobro anulado y productos devueltos al inventario.' : 'Cobro anulado.' });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo anular el cobro.' });
  }
}

// POST /api/caja/cierre  { efectivoContado, observaciones }   — cierra la caja de HOY
async function cerrar(req, res) {
  const contado = redondear(String(req.body.efectivoContado ?? '').replace(',', '.'));
  if (!(contado >= 0)) return res.status(400).json({ mensaje: 'Indica cuánto efectivo contaste (0 si no hubo).' });
  const fecha = HOY_LIMA();
  try {
    const pool = await getPool();
    const t = await totalesDelDia(pool, fecha);
    const diferencia = redondear(contado - t.Efectivo);
    await pool.request()
      .input('f', sql.Date, fecha).input('e', sql.Decimal(10, 2), t.Efectivo).input('t', sql.Decimal(10, 2), t.Tarjeta)
      .input('y', sql.Decimal(10, 2), t.Yape).input('p', sql.Decimal(10, 2), t.Plin).input('tot', sql.Decimal(10, 2), t.total)
      .input('c', sql.Decimal(10, 2), contado).input('d', sql.Decimal(10, 2), diferencia)
      .input('o', sql.NVarChar, String(req.body.observaciones || '').trim().slice(0, 300) || null).input('u', sql.Int, req.usuario.usuarioId)
      .query(`INSERT INTO CierresCaja (Fecha, TotalEfectivo, TotalTarjeta, TotalYape, TotalPlin, Total, EfectivoContado, Diferencia, Observaciones, UsuarioID)
              VALUES (@f, @e, @t, @y, @p, @tot, @c, @d, @o, @u)`);
    await registrarAuditoria(pool, { tabla: 'CierresCaja', registroId: 0, accion: 'Cerrar', usuarioId: req.usuario.usuarioId,
      detalle: `Cerró la caja del ${fecha}: total S/ ${t.total.toFixed(2)}, efectivo esperado S/ ${t.Efectivo.toFixed(2)}, contado S/ ${contado.toFixed(2)} (diferencia ${diferencia >= 0 ? '+' : ''}${diferencia.toFixed(2)})` });
    res.json({ mensaje: 'Caja cerrada.', diferencia });
  } catch (err) {
    console.error(err);
    if (err.number === 2627 || err.number === 2601) return res.status(409).json({ mensaje: 'La caja de hoy ya estaba cerrada.' });
    res.status(500).json({ mensaje: 'No se pudo cerrar la caja.' });
  }
}

// POST /api/caja/cierre/reabrir  { motivo }   (Administrativo) — reabre la caja de HOY
// Para cuando alguien la cerró por error: se borra el cierre y queda constancia
// en Actividad (quién la cerró, cuánto declaró y por qué se reabrió).
async function reabrir(req, res) {
  const motivo = String(req.body.motivo || '').trim().slice(0, 200);
  if (!motivo) return res.status(400).json({ mensaje: 'Indica por qué se reabre la caja.' });
  const fecha = HOY_LIMA();
  try {
    const pool = await getPool();
    const cierre = await cierreDe(pool, fecha);
    if (!cierre) return res.status(400).json({ mensaje: 'La caja de hoy no está cerrada.' });
    const r = await pool.request().input('id', sql.Int, cierre.CierreID).query('DELETE FROM CierresCaja WHERE CierreID = @id');
    if (!r.rowsAffected[0]) return res.status(409).json({ mensaje: 'La caja ya fue reabierta.' });
    await registrarAuditoria(pool, { tabla: 'CierresCaja', registroId: cierre.CierreID, accion: 'Anular', usuarioId: req.usuario.usuarioId,
      detalle: `Reabrió la caja del ${fecha} (la había cerrado ${cierre.CerradoPor}: total S/ ${Number(cierre.Total).toFixed(2)}, efectivo contado S/ ${Number(cierre.EfectivoContado).toFixed(2)}). Motivo: ${motivo}` });
    res.json({ mensaje: 'Caja reabierta: ya se pueden registrar cobros. Al final del día vuelve a cerrarla.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo reabrir la caja.' });
  }
}

// GET /api/caja/resumen?desde&hasta  — ingresos (para Reportes)
async function resumen(req, res) {
  const desde = fechaValida(req.query.desde) ? req.query.desde : HOY_LIMA().slice(0, 8) + '01';
  const hasta = fechaValida(req.query.hasta) ? req.query.hasta : HOY_LIMA();
  try {
    const pool = await getPool();
    const r = await pool.request().input('d', sql.Date, desde).input('h', sql.Date, hasta).query(`
      SELECT MetodoPago, SUM(Monto) AS Total, COUNT(*) AS Cantidad, SUM(Descuento) AS Descuentos FROM Pagos
      WHERE Anulado = 0 AND CAST(Fecha AS DATE) BETWEEN @d AND @h GROUP BY MetodoPago`);
    const porMetodo = { Efectivo: 0, Tarjeta: 0, Yape: 0, Plin: 0 };
    let total = 0; let cantidad = 0; let descuentos = 0;
    r.recordset.forEach((x) => { porMetodo[x.MetodoPago] = Number(x.Total); total += Number(x.Total); cantidad += x.Cantidad; descuentos += Number(x.Descuentos || 0); });
    res.json({ desde, hasta, total: redondear(total), cantidad, descuentos: redondear(descuentos), porMetodo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar el resumen de ingresos.' });
  }
}

// PUT /api/caja/tarifas/:id  { precio, activo }   (Administrativo)
async function actualizarTarifa(req, res) {
  const precio = redondear(req.body.precio);
  if (!(precio >= 0 && precio < 100000)) return res.status(400).json({ mensaje: 'Precio inválido.' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).input('p', sql.Decimal(10, 2), precio).input('a', sql.Bit, req.body.activo === false ? 0 : 1)
      .query('UPDATE Tarifas SET Precio = @p, Activo = @a OUTPUT INSERTED.Nombre WHERE TarifaID = @id');
    if (!r.recordset.length) return res.status(404).json({ mensaje: 'Servicio no encontrado.' });
    await registrarAuditoria(pool, { tabla: 'Tarifas', registroId: Number(req.params.id), accion: 'Actualizar', usuarioId: req.usuario.usuarioId,
      detalle: `Cambió la tarifa de "${r.recordset[0].Nombre}" a S/ ${precio.toFixed(2)}${req.body.activo === false ? ' (desactivada)' : ''}` });
    res.json({ mensaje: 'Tarifa actualizada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo actualizar la tarifa.' });
  }
}

module.exports = { delDia, catalogo, pendientes, cobrar, anular, cerrar, reabrir, resumen, actualizarTarifa };
