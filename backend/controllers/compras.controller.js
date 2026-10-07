// controllers/compras.controller.js
// Compras a proveedores (ingreso de mercadería) y cuentas por pagar.
//  - Una compra se registra con su comprobante (factura, boleta, guía): sube el
//    stock creando un LOTE por ítem (número, vencimiento, costo) y actualiza el
//    costo del producto. El mismo comprobante no entra dos veces.
//  - Al contado queda pagada; a crédito queda "por pagar" con fecha límite
//    (fecha de emisión + días de crédito del proveedor).
//  - Anular solo es posible si nada de esa compra se ha usado todavía.
//  - Pedido sugerido: lo que está en el mínimo, agrupado por proveedor habitual.
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { entradaLote, refrescarResumen } = require('../utils/lotes');
const { CATEGORIAS } = require('./inventario.controller');

const TIPOS_DOC = ['Factura', 'Boleta', 'Guía de remisión', 'Sin comprobante'];
const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Depósito', 'Yape', 'Plin', 'Tarjeta'];
const HOY = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || '')) && !Number.isNaN(Date.parse(`${f}T00:00:00Z`));
const sumarDias = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const HOY_SQL = 'CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE)';

// GET /api/compras?desde&hasta&proveedorId&estado=Pendiente|Pagado|Vencida
async function listar(req, res) {
  const q = req.query;
  const desde = esFecha(q.desde) ? q.desde : sumarDias(HOY(), -90);
  const hasta = esFecha(q.hasta) ? q.hasta : HOY();
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('d', sql.Date, desde).input('h', sql.Date, hasta)
      .input('p', sql.Int, /^\d+$/.test(q.proveedorId || '') ? Number(q.proveedorId) : null)
      .query(`
        SELECT c.CompraID, c.ProveedorID, p.RazonSocial, p.NombreComercial, p.Telefono, c.TipoDocumento, c.NumeroDocumento,
               c.FechaEmision, c.CondicionPago, c.FechaVencimientoPago, c.Total, c.EstadoPago, c.FechaPago, c.MetodoPago,
               c.Observaciones, c.Anulada, c.MotivoAnulacion, c.FechaRegistro,
               (SELECT COUNT(*) FROM ComprasDetalle d WHERE d.CompraID = c.CompraID) AS Items,
               CASE WHEN c.Anulada = 0 AND c.EstadoPago = 'Pendiente' AND c.FechaVencimientoPago < ${HOY_SQL} THEN 1 ELSE 0 END AS Vencida,
               CASE WHEN c.Anulada = 0 AND c.EstadoPago = 'Pendiente' AND c.FechaVencimientoPago BETWEEN ${HOY_SQL} AND DATEADD(DAY, 7, ${HOY_SQL}) THEN 1 ELSE 0 END AS PorVencer
        FROM Compras c INNER JOIN Proveedores p ON p.ProveedorID = c.ProveedorID
        WHERE (c.FechaEmision BETWEEN @d AND @h OR (c.EstadoPago = 'Pendiente' AND c.Anulada = 0))
          AND (@p IS NULL OR c.ProveedorID = @p)
        ORDER BY c.FechaEmision DESC, c.CompraID DESC`);
    let compras = r.recordset;
    if (q.estado === 'Pendiente' || q.estado === 'Pagado') compras = compras.filter((c) => !c.Anulada && c.EstadoPago === q.estado);
    if (q.estado === 'Vencida') compras = compras.filter((c) => c.Vencida);
    const res2 = (await pool.request().query(`
      SELECT
        ISNULL(SUM(CASE WHEN Anulada = 0 AND YEAR(FechaEmision) = YEAR(${HOY_SQL}) AND MONTH(FechaEmision) = MONTH(${HOY_SQL}) THEN Total END), 0) AS CompradoMes,
        ISNULL(SUM(CASE WHEN Anulada = 0 AND EstadoPago = 'Pendiente' THEN Total END), 0) AS PorPagar,
        ISNULL(SUM(CASE WHEN Anulada = 0 AND EstadoPago = 'Pendiente' AND FechaVencimientoPago < ${HOY_SQL} THEN Total END), 0) AS Vencido,
        SUM(CASE WHEN Anulada = 0 AND EstadoPago = 'Pendiente' AND FechaVencimientoPago < ${HOY_SQL} THEN 1 ELSE 0 END) AS FacturasVencidas,
        SUM(CASE WHEN Anulada = 0 AND EstadoPago = 'Pendiente' AND FechaVencimientoPago BETWEEN ${HOY_SQL} AND DATEADD(DAY, 7, ${HOY_SQL}) THEN 1 ELSE 0 END) AS VencenEstaSemana
      FROM Compras`)).recordset[0];
    res.json({ desde, hasta, compras, resumen: res2 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron cargar las compras.' });
  }
}

// GET /api/compras/:id — con sus ítems y lo que queda de cada lote
async function detalle(req, res) {
  try {
    const pool = await getPool();
    const c = (await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT c.*, p.RazonSocial, p.RUC, p.Telefono, (per.Nombres + ' ' + per.Apellidos) AS RegistradoPor
      FROM Compras c INNER JOIN Proveedores p ON p.ProveedorID = c.ProveedorID
      INNER JOIN Usuarios u ON u.UsuarioID = c.UsuarioID INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      WHERE c.CompraID = @id`)).recordset[0];
    if (!c) return res.status(404).json({ mensaje: 'Compra no encontrada.' });
    c.Items = (await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT d.*, m.NombreMedicamento, m.Unidad, l.CantidadActual AS QuedaEnLote
      FROM ComprasDetalle d INNER JOIN Medicamentos m ON m.MedicamentoID = d.MedicamentoID
      LEFT JOIN LotesInventario l ON l.LoteID = d.LoteID
      WHERE d.CompraID = @id ORDER BY d.DetalleID`)).recordset;
    res.json(c);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar la compra.' });
  }
}

// POST /api/compras
// { proveedorId, tipoDocumento, numeroDocumento, fechaEmision, condicionPago?, fechaVencimientoPago?, metodoPago?, observaciones?,
//   items: [{ medicamentoId | nuevoProducto: { nombre, categoria, unidad }, cantidad, costoUnitario, numeroLote?, fechaVencimiento?, precioVenta? }] }
async function crear(req, res) {
  const b = req.body || {};
  const tipoDoc = b.tipoDocumento;
  const numDoc = String(b.numeroDocumento || '').trim().toUpperCase() || null;
  const emision = b.fechaEmision;
  const hoy = HOY();
  if (!TIPOS_DOC.includes(tipoDoc)) return res.status(400).json({ mensaje: 'Elige el tipo de comprobante.' });
  if (['Factura', 'Boleta'].includes(tipoDoc) && !numDoc) return res.status(400).json({ mensaje: 'Escribe la serie y número del comprobante (ej. F001-000123).' });
  if (numDoc && !/^[A-Z0-9]{1,4}-\d{1,10}$/.test(numDoc)) return res.status(400).json({ mensaje: 'El número del comprobante debe ser serie-número, ej. F001-000123.' });
  if (!esFecha(emision) || emision > hoy) return res.status(400).json({ mensaje: 'La fecha de emisión no es válida (no puede ser futura).' });
  if (emision < sumarDias(hoy, -366)) return res.status(400).json({ mensaje: 'La fecha de emisión es de hace más de un año: revisa la fecha.' });
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ mensaje: 'Agrega al menos un producto a la compra.' });
  if (items.length > 100) return res.status(400).json({ mensaje: 'Demasiados ítems en una compra.' });

  const pool = await getPool();
  const prov = (await pool.request().input('id', sql.Int, Number(b.proveedorId) || 0)
    .query('SELECT ProveedorID, RazonSocial, CondicionPago, DiasCredito, Activo FROM Proveedores WHERE ProveedorID = @id')).recordset[0];
  if (!prov || !prov.Activo) return res.status(400).json({ mensaje: 'Elige un proveedor activo.' });

  const condicion = ['Contado', 'Crédito'].includes(b.condicionPago) ? b.condicionPago : prov.CondicionPago;
  let vencePago = null; let estado = 'Pagado'; let fechaPago = emision; let metodo = null;
  if (condicion === 'Crédito') {
    vencePago = esFecha(b.fechaVencimientoPago) ? b.fechaVencimientoPago : sumarDias(emision, prov.DiasCredito || 30);
    if (vencePago < emision) return res.status(400).json({ mensaje: 'La fecha límite de pago no puede ser anterior a la emisión.' });
    estado = 'Pendiente'; fechaPago = null;
  } else {
    metodo = METODOS_PAGO.includes(b.metodoPago) ? b.metodoPago : 'Efectivo';
  }

  // Validar ítems
  const limpios = [];
  for (const [i, it] of items.entries()) {
    const n = `Ítem ${i + 1}`;
    const cantidad = r2(it.cantidad); const costo = r2(it.costoUnitario);
    if (!(cantidad > 0 && cantidad <= 100000)) return res.status(400).json({ mensaje: `${n}: cantidad inválida.` });
    if (!(costo >= 0 && costo < 100000)) return res.status(400).json({ mensaje: `${n}: costo unitario inválido.` });
    const vence = it.fechaVencimiento ? String(it.fechaVencimiento) : null;
    if (vence && !esFecha(vence)) return res.status(400).json({ mensaje: `${n}: fecha de vencimiento inválida.` });
    if (vence && vence <= hoy) return res.status(400).json({ mensaje: `${n}: el producto ya está vencido; no lo ingreses al stock.` });
    const lote = String(it.numeroLote || '').trim().slice(0, 40) || null;
    const precioVenta = it.precioVenta === undefined || it.precioVenta === null || it.precioVenta === '' ? null : r2(it.precioVenta);
    if (precioVenta !== null && !(precioVenta >= 0)) return res.status(400).json({ mensaje: `${n}: precio de venta inválido.` });
    let producto = null;
    if (it.medicamentoId) {
      producto = (await pool.request().input('id', sql.Int, Number(it.medicamentoId)).query('SELECT MedicamentoID, NombreMedicamento, Categoria, Unidad FROM Medicamentos WHERE MedicamentoID = @id AND Activo = 1')).recordset[0];
      if (!producto) return res.status(400).json({ mensaje: `${n}: el producto no existe en el inventario.` });
    } else if (it.nuevoProducto && String(it.nuevoProducto.nombre || '').trim()) {
      const np = it.nuevoProducto;
      if (np.categoria && !CATEGORIAS.includes(np.categoria)) return res.status(400).json({ mensaje: `${n}: categoría inválida.` });
      producto = { nuevo: true, NombreMedicamento: String(np.nombre).trim().slice(0, 150), Categoria: np.categoria || 'Medicamento', Unidad: String(np.unidad || 'unid.').trim().slice(0, 20) || 'unid.' };
    } else return res.status(400).json({ mensaje: `${n}: elige un producto.` });
    if (producto.Categoria === 'Vacuna' && (!lote || !vence)) return res.status(400).json({ mensaje: `${n}: las vacunas necesitan número de lote y vencimiento.` });
    limpios.push({ producto, cantidad, costo, lote, vence, precioVenta, subtotal: r2(cantidad * costo) });
  }
  const total = r2(limpios.reduce((s, x) => s + x.subtotal, 0));

  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const ins = await new sql.Request(tx)
      .input('prov', sql.Int, prov.ProveedorID).input('tipo', sql.NVarChar(20), tipoDoc).input('num', sql.NVarChar(30), numDoc)
      .input('emi', sql.Date, emision).input('cond', sql.NVarChar(10), condicion).input('vence', sql.Date, vencePago)
      .input('total', sql.Decimal(12, 2), total).input('estado', sql.NVarChar(10), estado).input('fpago', sql.Date, fechaPago)
      .input('metodo', sql.NVarChar(20), metodo).input('obs', sql.NVarChar(300), String(b.observaciones || '').trim().slice(0, 300) || null)
      .input('u', sql.Int, req.usuario.usuarioId)
      .query(`INSERT INTO Compras (ProveedorID, TipoDocumento, NumeroDocumento, FechaEmision, CondicionPago, FechaVencimientoPago, Total, EstadoPago, FechaPago, MetodoPago, Observaciones, UsuarioID)
              OUTPUT INSERTED.CompraID VALUES (@prov, @tipo, @num, @emi, @cond, @vence, @total, @estado, @fpago, @metodo, @obs, @u)`);
    const compraId = ins.recordset[0].CompraID;
    const ref = `Compra #${compraId}${numDoc ? ` (${tipoDoc} ${numDoc})` : ''}`;
    const idsComprados = [];

    for (const x of limpios) {
      let medId = x.producto.MedicamentoID;
      if (x.producto.nuevo) {
        // Producto nuevo: si ya existe con ese nombre se usa; si no, se crea
        const ya = (await new sql.Request(tx).input('n', sql.NVarChar, x.producto.NombreMedicamento).query('SELECT MedicamentoID FROM Medicamentos WHERE NombreMedicamento = @n')).recordset[0];
        medId = ya ? ya.MedicamentoID : (await new sql.Request(tx)
          .input('n', sql.NVarChar, x.producto.NombreMedicamento).input('cat', sql.NVarChar, x.producto.Categoria).input('u', sql.NVarChar, x.producto.Unidad)
          .input('refr', sql.Bit, x.producto.Categoria === 'Vacuna' ? 1 : 0)
          .query(`INSERT INTO Medicamentos (NombreMedicamento, Categoria, Unidad, Stock, StockMinimo, ControlStock, Refrigerado)
                  OUTPUT INSERTED.MedicamentoID VALUES (@n, @cat, @u, 0, 0, 1, @refr)`)).recordset[0].MedicamentoID;
        if (ya) await new sql.Request(tx).input('id', sql.Int, medId).query('UPDATE Medicamentos SET Activo = 1 WHERE MedicamentoID = @id');
      }
      const st = await new sql.Request(tx)
        .input('id', sql.Int, medId).input('c', sql.Decimal(10, 2), x.cantidad).input('costo', sql.Decimal(10, 2), x.costo)
        .input('prov', sql.Int, prov.ProveedorID).input('precio', sql.Decimal(10, 2), x.precioVenta)
        .query(`UPDATE Medicamentos SET Stock = Stock + @c, ControlStock = 1, CostoUnitario = @costo,
                  ProveedorID = ISNULL(ProveedorID, @prov), PrecioVenta = ISNULL(@precio, PrecioVenta)
                OUTPUT INSERTED.Stock WHERE MedicamentoID = @id`);
      const loteId = await entradaLote(tx, { medicamentoId: medId, cantidad: x.cantidad, numeroLote: x.lote, fechaVencimiento: x.vence, costo: x.costo, compraId, origen: 'Compra' });
      await new sql.Request(tx).input('id', sql.Int, medId).input('c', sql.Decimal(10, 2), x.cantidad).input('s', sql.Decimal(10, 2), st.recordset[0].Stock)
        .input('m', sql.NVarChar, `${ref}${x.lote ? ` · lote ${x.lote}` : ''}`.slice(0, 200)).input('u', sql.Int, req.usuario.usuarioId)
        .query("INSERT INTO MovimientosInventario (MedicamentoID, Tipo, Cantidad, StockResultante, Motivo, UsuarioID) VALUES (@id, 'Entrada', @c, @s, @m, @u)");
      await new sql.Request(tx)
        .input('compra', sql.Int, compraId).input('id', sql.Int, medId).input('c', sql.Decimal(10, 2), x.cantidad).input('costo', sql.Decimal(10, 2), x.costo)
        .input('sub', sql.Decimal(12, 2), x.subtotal).input('lote', sql.NVarChar(40), x.lote).input('vence', sql.Date, x.vence).input('loteId', sql.Int, loteId)
        .query(`INSERT INTO ComprasDetalle (CompraID, MedicamentoID, Cantidad, CostoUnitario, Subtotal, NumeroLote, FechaVencimiento, LoteID)
                VALUES (@compra, @id, @c, @costo, @sub, @lote, @vence, @loteId)`);
      idsComprados.push({ id: medId, nombre: x.producto.NombreMedicamento });
    }
    // Las solicitudes de reposición de estos productos quedan atendidas con esta compra
    for (const p of idsComprados) {
      await new sql.Request(tx).input('id', sql.Int, p.id).input('n', sql.NVarChar(150), p.nombre).input('compra', sql.Int, compraId).input('u', sql.Int, req.usuario.usuarioId)
        .query(`UPDATE SolicitudesReposicion SET Estado = 'Atendida', CompraID = @compra, AtendidaPor = @u, FechaAtencion = DATEADD(HOUR, -5, SYSUTCDATETIME()),
                  MedicamentoID = ISNULL(MedicamentoID, @id)
                WHERE Estado = 'Pendiente' AND (MedicamentoID = @id OR (MedicamentoID IS NULL AND NombreProducto = @n))`);
    }
    await tx.commit();
    await registrarAuditoria(pool, { tabla: 'Compras', registroId: compraId, accion: 'Crear', usuarioId: req.usuario.usuarioId,
      detalle: `Registró ${ref} de ${prov.RazonSocial}: ${limpios.length} producto(s), S/ ${total.toFixed(2)} · ${condicion === 'Crédito' ? `por pagar hasta ${vencePago}` : 'pagada al contado'}` });
    res.status(201).json({ mensaje: 'Compra registrada: el stock ya se actualizó.', compraId, total });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    if (err.number === 2601 || err.number === 2627) return res.status(409).json({ mensaje: 'Ese comprobante de ese proveedor ya está registrado.' });
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo registrar la compra.' });
  }
}

// POST /api/compras/:id/pagar  { fechaPago?, metodoPago }
async function pagar(req, res) {
  const metodo = req.body.metodoPago;
  const fecha = esFecha(req.body.fechaPago) ? req.body.fechaPago : HOY();
  if (!METODOS_PAGO.includes(metodo)) return res.status(400).json({ mensaje: 'Elige cómo se pagó.' });
  if (fecha > HOY()) return res.status(400).json({ mensaje: 'La fecha de pago no puede ser futura.' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).input('f', sql.Date, fecha).input('m', sql.NVarChar(20), metodo)
      .query(`UPDATE Compras SET EstadoPago = 'Pagado', FechaPago = @f, MetodoPago = @m
              OUTPUT INSERTED.Total, INSERTED.NumeroDocumento WHERE CompraID = @id AND EstadoPago = 'Pendiente' AND Anulada = 0 AND FechaEmision <= @f`);
    if (!r.recordset.length) return res.status(400).json({ mensaje: 'Esa compra no está pendiente de pago (o la fecha es anterior a la emisión).' });
    await registrarAuditoria(pool, { tabla: 'Compras', registroId: Number(req.params.id), accion: 'Pagar', usuarioId: req.usuario.usuarioId,
      detalle: `Pagó la compra #${req.params.id}${r.recordset[0].NumeroDocumento ? ` (${r.recordset[0].NumeroDocumento})` : ''}: S/ ${Number(r.recordset[0].Total).toFixed(2)} por ${metodo}` });
    res.json({ mensaje: 'Pago registrado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo registrar el pago.' });
  }
}

// POST /api/compras/:id/anular  { motivo } — solo si nada de la compra se ha usado
async function anular(req, res) {
  const motivo = String(req.body.motivo || '').trim().slice(0, 200);
  if (!motivo) return res.status(400).json({ mensaje: 'Indica el motivo de la anulación.' });
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const c = (await new sql.Request(tx).input('id', sql.Int, req.params.id).query('SELECT CompraID, Anulada, Total FROM Compras WITH (UPDLOCK) WHERE CompraID = @id')).recordset[0];
    if (!c) { await tx.rollback(); return res.status(404).json({ mensaje: 'Compra no encontrada.' }); }
    if (c.Anulada) { await tx.rollback(); return res.status(400).json({ mensaje: 'Esa compra ya estaba anulada.' }); }
    const det = (await new sql.Request(tx).input('id', sql.Int, req.params.id).query(`
      SELECT d.MedicamentoID, d.Cantidad, d.LoteID, l.CantidadActual, l.CantidadInicial, m.NombreMedicamento
      FROM ComprasDetalle d INNER JOIN LotesInventario l WITH (UPDLOCK) ON l.LoteID = d.LoteID INNER JOIN Medicamentos m ON m.MedicamentoID = d.MedicamentoID
      WHERE d.CompraID = @id`)).recordset;
    const usados = det.filter((d) => Number(d.CantidadActual) < Number(d.CantidadInicial));
    if (usados.length) {
      await tx.rollback();
      return res.status(400).json({ mensaje: `No se puede anular: ya se usaron unidades de ${usados.map((u) => u.NombreMedicamento).join(', ')}. Si hubo un error, corrígelo con un ajuste de inventario.` });
    }
    for (const d of det) {
      await new sql.Request(tx).input('l', sql.Int, d.LoteID).query('UPDATE LotesInventario SET CantidadActual = 0 WHERE LoteID = @l');
      const st = await new sql.Request(tx).input('id', sql.Int, d.MedicamentoID).input('c', sql.Decimal(10, 2), d.Cantidad)
        .query('UPDATE Medicamentos SET Stock = CASE WHEN Stock >= @c THEN Stock - @c ELSE 0 END OUTPUT INSERTED.Stock WHERE MedicamentoID = @id');
      await new sql.Request(tx).input('id', sql.Int, d.MedicamentoID).input('c', sql.Decimal(10, 2), d.Cantidad).input('s', sql.Decimal(10, 2), st.recordset[0].Stock)
        .input('m', sql.NVarChar, `Anulación de la compra #${req.params.id}`).input('u', sql.Int, req.usuario.usuarioId)
        .query("INSERT INTO MovimientosInventario (MedicamentoID, Tipo, Cantidad, StockResultante, Motivo, UsuarioID) VALUES (@id, 'Salida', @c, @s, @m, @u)");
      await refrescarResumen(tx, d.MedicamentoID);
    }
    await new sql.Request(tx).input('id', sql.Int, req.params.id).input('m', sql.NVarChar(200), motivo)
      .query('UPDATE Compras SET Anulada = 1, MotivoAnulacion = @m WHERE CompraID = @id');
    await tx.commit();
    await registrarAuditoria(pool, { tabla: 'Compras', registroId: Number(req.params.id), accion: 'Anular', usuarioId: req.usuario.usuarioId,
      detalle: `Anuló la compra #${req.params.id} (S/ ${Number(c.Total).toFixed(2)}): el stock se retiró. Motivo: ${motivo}` });
    res.json({ mensaje: 'Compra anulada y stock retirado.' });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo anular la compra.' });
  }
}

// GET /api/compras/pedido-sugerido — productos en el mínimo, por proveedor habitual
async function pedidoSugerido(req, res) {
  try {
    const pool = await getPool();
    // 1) En el mínimo o debajo   2) Pedidos por el personal (aunque haya stock)
    const r = await pool.request().query(`
      SELECT m.MedicamentoID, m.NombreMedicamento, m.Categoria, m.Unidad, m.Presentacion, m.Stock, m.StockMinimo, m.CostoUnitario, m.ControlStock,
             m.ProveedorID, p.RazonSocial, p.NombreComercial, p.Telefono, p.Correo, p.DiasEntrega, p.Contacto,
             s.SolicitudID, s.Cantidad AS CantidadSolicitada, s.Nota, s.Urgente, (per.Nombres + ' ' + per.Apellidos) AS Solicitante
      FROM Medicamentos m
      LEFT JOIN Proveedores p ON p.ProveedorID = m.ProveedorID
      LEFT JOIN SolicitudesReposicion s ON s.MedicamentoID = m.MedicamentoID AND s.Estado = 'Pendiente'
      LEFT JOIN Usuarios u ON u.UsuarioID = s.UsuarioID LEFT JOIN Personas per ON per.PersonaID = u.PersonaID
      WHERE m.Activo = 1 AND ((m.ControlStock = 1 AND m.Stock <= m.StockMinimo) OR s.SolicitudID IS NOT NULL)
      ORDER BY p.RazonSocial, s.Urgente DESC, m.NombreMedicamento`);
    const grupos = new Map();
    const grupo = (k, m) => {
      if (!grupos.has(k)) grupos.set(k, { proveedorId: m.ProveedorID || null, razonSocial: m.RazonSocial || (k === 'nuevos' ? 'Productos nuevos solicitados' : 'Sin proveedor asignado'), nombreComercial: m.NombreComercial, telefono: m.Telefono, correo: m.Correo, contacto: m.Contacto, diasEntrega: m.DiasEntrega, items: [] });
      return grupos.get(k);
    };
    r.recordset.forEach((m) => {
      // Se sugiere reponer hasta el doble del mínimo (al menos 1); si alguien pidió más, se respeta
      const enMinimo = m.ControlStock && Number(m.Stock) <= Number(m.StockMinimo);
      const porMinimo = enMinimo ? Math.max(1, Math.ceil(Number(m.StockMinimo) * 2 - Number(m.Stock))) : 0;
      const sugerido = Math.max(porMinimo, m.CantidadSolicitada ? Math.ceil(Number(m.CantidadSolicitada)) : 0) || 1;
      grupo(m.ProveedorID || 0, m).items.push({ medicamentoId: m.MedicamentoID, nombre: m.NombreMedicamento, categoria: m.Categoria, unidad: m.Unidad, presentacion: m.Presentacion,
        stock: Number(m.Stock), minimo: Number(m.StockMinimo), sugerido, costo: m.CostoUnitario != null ? Number(m.CostoUnitario) : null,
        solicitud: m.SolicitudID ? { id: m.SolicitudID, por: m.Solicitante, nota: m.Nota, urgente: !!m.Urgente, cantidad: m.CantidadSolicitada != null ? Number(m.CantidadSolicitada) : null } : null });
    });
    // Productos que aún no existen en el inventario
    const nuevos = (await pool.request().query(`
      SELECT s.SolicitudID, s.NombreProducto, s.Cantidad, s.Nota, s.Urgente, (per.Nombres + ' ' + per.Apellidos) AS Solicitante
      FROM SolicitudesReposicion s INNER JOIN Usuarios u ON u.UsuarioID = s.UsuarioID INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      WHERE s.Estado = 'Pendiente' AND s.MedicamentoID IS NULL ORDER BY s.Urgente DESC, s.Fecha`)).recordset;
    nuevos.forEach((s) => grupo('nuevos', {}).items.push({ medicamentoId: null, nombre: s.NombreProducto, categoria: 'Nuevo', unidad: 'unid.', presentacion: null,
      stock: 0, minimo: 0, sugerido: s.Cantidad ? Math.ceil(Number(s.Cantidad)) : 1, costo: null,
      solicitud: { id: s.SolicitudID, por: s.Solicitante, nota: s.Nota, urgente: !!s.Urgente, cantidad: s.Cantidad != null ? Number(s.Cantidad) : null } }));
    res.json([...grupos.values()]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo calcular el pedido sugerido.' });
  }
}

module.exports = { listar, detalle, crear, pagar, anular, pedidoSugerido, TIPOS_DOC, METODOS_PAGO };
