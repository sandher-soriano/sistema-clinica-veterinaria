// controllers/inventario.controller.js
// Inventario de medicamentos, vacunas e insumos (tabla Medicamentos).
//  - Cada cambio de stock queda como movimiento (Entrada / Salida / Ajuste por conteo).
//  - El stock nunca queda negativo; el UPDATE es atómico (sin carreras).
//  - El stock vive en LOTES (utils/lotes.js): las salidas usan primero el lote
//    que vence antes (FEFO) y el lote "en uso" se muestra en el producto.
//  - Alertas: stock bajo (≤ mínimo) y vencimiento (vencido o en ≤ 60 días).
// Los medicamentos que se escriben al recetar también aparecen aquí; solo los
// que tienen "ControlStock" generan alertas de stock.
const { sql, getPool } = require('../config/db');
const { registrarAuditoria } = require('../utils/auditoria');
const { entradaLote, salidaFEFO, refrescarResumen } = require('../utils/lotes');

const CATEGORIAS = ['Medicamento', 'Vacuna', 'Antiparasitario', 'Insumo', 'Alimento'];
const HOY = 'CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE)';
const HOY_JS = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

const SELECT_ITEMS = `
  SELECT m.MedicamentoID, m.NombreMedicamento, m.Categoria, m.Presentacion, m.Unidad, m.Stock, m.StockMinimo,
         m.PrecioVenta, m.CostoUnitario, m.Lote, m.FechaVencimiento, m.ControlStock, m.Activo,
         m.RegistroSenasa, m.Laboratorio, m.Refrigerado, m.ProveedorID, pv.RazonSocial AS Proveedor,
         (SELECT COUNT(*) FROM LotesInventario l WHERE l.MedicamentoID = m.MedicamentoID AND l.CantidadActual > 0) AS LotesActivos,
         (SELECT TOP 1 s.SolicitudID FROM SolicitudesReposicion s WHERE s.MedicamentoID = m.MedicamentoID AND s.Estado = 'Pendiente') AS SolicitudPendiente,
         CASE WHEN m.ControlStock = 1 AND m.Stock <= m.StockMinimo THEN 1 ELSE 0 END AS BajoStock,
         CASE WHEN m.FechaVencimiento IS NOT NULL AND m.FechaVencimiento < ${HOY} THEN 1 ELSE 0 END AS Vencido,
         CASE WHEN m.FechaVencimiento IS NOT NULL AND m.FechaVencimiento >= ${HOY}
                   AND m.FechaVencimiento <= DATEADD(DAY, 60, ${HOY}) THEN 1 ELSE 0 END AS PorVencer
  FROM Medicamentos m LEFT JOIN Proveedores pv ON pv.ProveedorID = m.ProveedorID`;

// GET /api/inventario
async function listar(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`${SELECT_ITEMS} WHERE m.Activo = 1 ORDER BY m.ControlStock DESC, m.NombreMedicamento`);
    // El costo de compra solo lo ve el área administrativa
    if (!req.usuario.accesoConfig) r.recordset.forEach((m) => { delete m.CostoUnitario; });
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar el inventario.' });
  }
}

// GET /api/inventario/alertas  (para el dashboard)
async function alertas(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT SUM(BajoStock) AS BajoStock, SUM(Vencido) AS Vencidos, SUM(PorVencer) AS PorVencer FROM (${SELECT_ITEMS} WHERE m.Activo = 1) x
    `);
    const fila = r.recordset[0] || {};
    res.json({ bajoStock: fila.BajoStock || 0, vencidos: fila.Vencidos || 0, porVencer: fila.PorVencer || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron cargar las alertas.' });
  }
}

function validarItem(b) {
  const nombre = String(b.nombre || '').trim();
  if (!nombre) return 'El nombre es obligatorio.';
  if (nombre.length > 150) return 'El nombre es demasiado largo.';
  if (b.categoria && !CATEGORIAS.includes(b.categoria)) return 'Categoría inválida.';
  for (const [campo, texto] of [['stockMinimo', 'El stock mínimo'], ['precioVenta', 'El precio'], ['costoUnitario', 'El costo']]) {
    if (b[campo] !== undefined && b[campo] !== null && b[campo] !== '' && !(Number(b[campo]) >= 0)) return `${texto} no puede ser negativo.`;
  }
  if (b.fechaVencimiento && !/^\d{4}-\d{2}-\d{2}$/.test(b.fechaVencimiento)) return 'Fecha de vencimiento inválida.';
  if (b.registroSenasa && String(b.registroSenasa).length > 30) return 'El registro SENASA es demasiado largo.';
  return null;
}
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const txt = (v, max) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };

async function proveedorValido(pool, id) {
  if (!id) return true;
  const r = await pool.request().input('id', sql.Int, Number(id)).query('SELECT 1 AS x FROM Proveedores WHERE ProveedorID = @id');
  return r.recordset.length > 0;
}

// POST /api/inventario   (Administrativo) — producto nuevo, con stock inicial opcional
async function crear(req, res) {
  const b = req.body;
  const error = validarItem(b);
  if (error) return res.status(400).json({ mensaje: error });
  const stockInicial = num(b.stockInicial) || 0;
  if (stockInicial < 0) return res.status(400).json({ mensaje: 'El stock inicial no puede ser negativo.' });
  const pool = await getPool();
  if (!(await proveedorValido(pool, b.proveedorId))) return res.status(400).json({ mensaje: 'El proveedor no existe.' });
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const existe = await new sql.Request(tx).input('n', sql.NVarChar, b.nombre.trim())
      .query('SELECT MedicamentoID FROM Medicamentos WHERE NombreMedicamento = @n');
    if (existe.recordset.length) {
      await tx.rollback();
      return res.status(409).json({ mensaje: 'Ya existe un producto con ese nombre: edítalo en la lista.' });
    }
    const categoria = b.categoria || 'Medicamento';
    const r = await new sql.Request(tx)
      .input('nombre', sql.NVarChar, b.nombre.trim())
      .input('categoria', sql.NVarChar, categoria)
      .input('presentacion', sql.NVarChar, b.presentacion || null)
      .input('unidad', sql.NVarChar, b.unidad || 'unid.')
      .input('stock', sql.Decimal(10, 2), stockInicial)
      .input('stockMinimo', sql.Decimal(10, 2), num(b.stockMinimo) || 0)
      .input('precio', sql.Decimal(10, 2), num(b.precioVenta))
      .input('costo', sql.Decimal(10, 2), num(b.costoUnitario))
      .input('prov', sql.Int, num(b.proveedorId))
      .input('senasa', sql.NVarChar(30), txt(b.registroSenasa, 30))
      .input('lab', sql.NVarChar(80), txt(b.laboratorio, 80))
      .input('refr', sql.Bit, b.refrigerado === undefined ? (categoria === 'Vacuna' ? 1 : 0) : (b.refrigerado ? 1 : 0))
      .query(`INSERT INTO Medicamentos (NombreMedicamento, Categoria, Presentacion, Unidad, Stock, StockMinimo, PrecioVenta, CostoUnitario,
                ProveedorID, RegistroSenasa, Laboratorio, Refrigerado, ControlStock)
              OUTPUT INSERTED.MedicamentoID
              VALUES (@nombre, @categoria, @presentacion, @unidad, @stock, @stockMinimo, @precio, @costo, @prov, @senasa, @lab, @refr, 1)`);
    const id = r.recordset[0].MedicamentoID;
    if (stockInicial > 0) {
      await entradaLote(tx, { medicamentoId: id, cantidad: stockInicial, numeroLote: txt(b.lote, 40), fechaVencimiento: b.fechaVencimiento || null, costo: num(b.costoUnitario), origen: 'Inicial' });
      await new sql.Request(tx).input('id', sql.Int, id).input('c', sql.Decimal(10, 2), stockInicial).input('u', sql.Int, req.usuario.usuarioId)
        .query("INSERT INTO MovimientosInventario (MedicamentoID, Tipo, Cantidad, StockResultante, Motivo, UsuarioID) VALUES (@id, 'Entrada', @c, @c, N'Stock inicial', @u)");
    }
    await tx.commit();
    await registrarAuditoria(pool, { tabla: 'Medicamentos', registroId: id, accion: 'Crear', usuarioId: req.usuario.usuarioId, detalle: `Agregó al inventario: ${b.nombre.trim()}` });
    res.status(201).json({ mensaje: 'Producto agregado al inventario.', medicamentoId: id });
  } catch (err) {
    console.error(err);
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    res.status(500).json({ mensaje: 'No se pudo agregar el producto.' });
  }
}

// PUT /api/inventario/:id   (Administrativo) — datos del producto
// (el stock se cambia con movimientos o compras; lote y vencimiento, en cada lote)
async function actualizar(req, res) {
  const b = req.body;
  const error = validarItem(b);
  if (error) return res.status(400).json({ mensaje: error });
  try {
    const pool = await getPool();
    if (!(await proveedorValido(pool, b.proveedorId))) return res.status(400).json({ mensaje: 'El proveedor no existe.' });
    const r = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('nombre', sql.NVarChar, b.nombre.trim())
      .input('categoria', sql.NVarChar, b.categoria || 'Medicamento')
      .input('presentacion', sql.NVarChar, b.presentacion || null)
      .input('unidad', sql.NVarChar, b.unidad || 'unid.')
      .input('stockMinimo', sql.Decimal(10, 2), num(b.stockMinimo) || 0)
      .input('precio', sql.Decimal(10, 2), num(b.precioVenta))
      .input('costo', sql.Decimal(10, 2), num(b.costoUnitario))
      .input('prov', sql.Int, num(b.proveedorId))
      .input('senasa', sql.NVarChar(30), txt(b.registroSenasa, 30))
      .input('lab', sql.NVarChar(80), txt(b.laboratorio, 80))
      .input('refr', sql.Bit, b.refrigerado ? 1 : 0)
      .input('control', sql.Bit, b.controlStock === false ? 0 : 1)
      .query(`UPDATE Medicamentos SET NombreMedicamento = @nombre, Categoria = @categoria, Presentacion = @presentacion, Unidad = @unidad,
                StockMinimo = @stockMinimo, PrecioVenta = @precio, CostoUnitario = @costo, ProveedorID = @prov,
                RegistroSenasa = @senasa, Laboratorio = @lab, Refrigerado = @refr, ControlStock = @control
              WHERE MedicamentoID = @id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ mensaje: 'Producto no encontrado.' });
    await registrarAuditoria(pool, { tabla: 'Medicamentos', registroId: Number(req.params.id), accion: 'Actualizar', usuarioId: req.usuario.usuarioId, detalle: `Editó el producto ${b.nombre.trim()}` });
    res.json({ mensaje: 'Producto actualizado.' });
  } catch (err) {
    console.error(err);
    if (err.number === 2627 || err.number === 2601) return res.status(409).json({ mensaje: 'Ya existe un producto con ese nombre.' });
    res.status(500).json({ mensaje: 'No se pudo actualizar el producto.' });
  }
}

// POST /api/inventario/:id/movimiento  { tipo: Entrada|Salida|Ajuste, cantidad, motivo, lote?, fechaVencimiento?, costoUnitario? }
// Entrada/Salida: suma/resta "cantidad". Ajuste: "cantidad" es el stock contado (nuevo valor).
async function movimiento(req, res) {
  const tipo = req.body.tipo;
  const cantidad = Number(req.body.cantidad);
  const motivo = String(req.body.motivo || '').trim().slice(0, 200) || null;
  const vence = req.body.fechaVencimiento || null;
  if (!['Entrada', 'Salida', 'Ajuste'].includes(tipo)) return res.status(400).json({ mensaje: 'Tipo de movimiento inválido.' });
  if (!(cantidad >= 0) || (tipo !== 'Ajuste' && cantidad === 0)) return res.status(400).json({ mensaje: 'Indica una cantidad válida.' });
  if (tipo === 'Ajuste' && !motivo) return res.status(400).json({ mensaje: 'Indica el motivo del ajuste (ej. "conteo mensual").' });
  if (vence && (!/^\d{4}-\d{2}-\d{2}$/.test(vence) || vence <= HOY_JS())) return res.status(400).json({ mensaje: 'La fecha de vencimiento del lote no es válida o ya pasó.' });
  // El costo de compra lo registra solo el área administrativa
  const costo = req.usuario.accesoConfig ? num(req.body.costoUnitario) : null;
  if (costo !== null && !(costo >= 0)) return res.status(400).json({ mensaje: 'El costo no puede ser negativo.' });
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const antes = (await new sql.Request(tx).input('id', sql.Int, req.params.id)
      .query('SELECT Stock FROM Medicamentos WITH (UPDLOCK) WHERE MedicamentoID = @id AND Activo = 1')).recordset[0];
    if (!antes) { await tx.rollback(); return res.status(404).json({ mensaje: 'Producto no encontrado.' }); }
    // UPDATE atómico: la condición evita que el stock quede negativo
    const r = await new sql.Request(tx)
      .input('id', sql.Int, req.params.id)
      .input('c', sql.Decimal(10, 2), cantidad)
      .query(`
        UPDATE Medicamentos SET Stock = CASE
            WHEN '${tipo}' = 'Entrada' THEN Stock + @c
            WHEN '${tipo}' = 'Salida'  THEN Stock - @c
            ELSE @c END,
          ControlStock = 1
        OUTPUT INSERTED.Stock, INSERTED.NombreMedicamento, INSERTED.Unidad
        WHERE MedicamentoID = @id AND Activo = 1 ${tipo === 'Salida' ? 'AND Stock >= @c' : ''}
      `);
    if (!r.recordset.length) {
      await tx.rollback();
      const existe = await pool.request().input('id', sql.Int, req.params.id).query('SELECT Stock, Unidad FROM Medicamentos WHERE MedicamentoID = @id');
      return res.status(400).json({ mensaje: `No hay stock suficiente (quedan ${Number(existe.recordset[0].Stock)} ${existe.recordset[0].Unidad}).` });
    }
    const { Stock, NombreMedicamento, Unidad } = r.recordset[0];
    const mov = await new sql.Request(tx)
      .input('id', sql.Int, req.params.id).input('tipo', sql.NVarChar, tipo).input('c', sql.Decimal(10, 2), cantidad)
      .input('s', sql.Decimal(10, 2), Stock).input('m', sql.NVarChar, motivo).input('u', sql.Int, req.usuario.usuarioId)
      .query('INSERT INTO MovimientosInventario (MedicamentoID, Tipo, Cantidad, StockResultante, Motivo, UsuarioID) OUTPUT INSERTED.MovimientoID VALUES (@id, @tipo, @c, @s, @m, @u)');
    const movimientoId = mov.recordset[0].MovimientoID;

    // Reflejo en lotes
    const medId = Number(req.params.id);
    const diferencia = Math.round((Number(Stock) - Number(antes.Stock)) * 100) / 100;
    if (tipo === 'Entrada') {
      await entradaLote(tx, { medicamentoId: medId, cantidad, numeroLote: txt(req.body.lote, 40), fechaVencimiento: vence, costo, origen: 'Entrada' });
      if (costo !== null) await new sql.Request(tx).input('id', sql.Int, medId).input('c', sql.Decimal(10, 2), costo).query('UPDATE Medicamentos SET CostoUnitario = @c WHERE MedicamentoID = @id');
    } else if (diferencia < 0) {
      await salidaFEFO(tx, medId, -diferencia, { movimientoId });
    } else if (diferencia > 0) {
      await entradaLote(tx, { medicamentoId: medId, cantidad: diferencia, numeroLote: txt(req.body.lote, 40), fechaVencimiento: vence, origen: 'Ajuste' });
    }
    await tx.commit();
    await registrarAuditoria(pool, { tabla: 'Medicamentos', registroId: medId, accion: 'Movimiento', usuarioId: req.usuario.usuarioId,
      detalle: `${tipo} de ${cantidad} ${Unidad} de ${NombreMedicamento}${motivo ? ` (${motivo})` : ''}. Stock: ${Number(Stock)}` });
    res.json({ mensaje: 'Movimiento registrado.', stock: Number(Stock) });
  } catch (err) {
    console.error(err);
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    res.status(500).json({ mensaje: 'No se pudo registrar el movimiento.' });
  }
}

// GET /api/inventario/:id/movimientos
async function movimientos(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT TOP 50 mv.MovimientoID, mv.Tipo, mv.Cantidad, mv.StockResultante, mv.Motivo, mv.Fecha,
             (per.Nombres + ' ' + per.Apellidos) AS Usuario
      FROM MovimientosInventario mv
      INNER JOIN Usuarios u ON u.UsuarioID = mv.UsuarioID
      INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      WHERE mv.MedicamentoID = @id ORDER BY mv.Fecha DESC, mv.MovimientoID DESC`);
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo cargar el historial.' });
  }
}

// GET /api/inventario/:id/lotes — lotes con unidades (y los agotados recientes)
async function lotes(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT TOP 30 l.LoteID, l.NumeroLote, l.FechaVencimiento, l.CantidadInicial, l.CantidadActual, l.CostoUnitario, l.Origen, l.FechaIngreso,
             l.CompraID, c.NumeroDocumento, p.RazonSocial AS Proveedor,
             CASE WHEN l.FechaVencimiento < ${HOY} THEN 1 ELSE 0 END AS Vencido,
             CASE WHEN l.FechaVencimiento BETWEEN ${HOY} AND DATEADD(DAY, 60, ${HOY}) THEN 1 ELSE 0 END AS PorVencer
      FROM LotesInventario l
      LEFT JOIN Compras c ON c.CompraID = l.CompraID LEFT JOIN Proveedores p ON p.ProveedorID = c.ProveedorID
      WHERE l.MedicamentoID = @id
      ORDER BY CASE WHEN l.CantidadActual > 0 THEN 0 ELSE 1 END,
               CASE WHEN l.FechaVencimiento IS NULL THEN 1 ELSE 0 END, l.FechaVencimiento, l.LoteID DESC`);
    if (!req.usuario.accesoConfig) r.recordset.forEach((l) => { delete l.CostoUnitario; });
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron cargar los lotes.' });
  }
}

// PUT /api/inventario/lotes/:id  { numeroLote, fechaVencimiento }  (Administrativo) — corregir datos del lote
async function editarLote(req, res) {
  const vence = req.body.fechaVencimiento || null;
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) return res.status(400).json({ mensaje: 'Fecha de vencimiento inválida.' });
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const r = await new sql.Request(tx).input('id', sql.Int, req.params.id).input('l', sql.NVarChar(40), txt(req.body.numeroLote, 40)).input('v', sql.Date, vence)
      .query('UPDATE LotesInventario SET NumeroLote = @l, FechaVencimiento = @v OUTPUT INSERTED.MedicamentoID WHERE LoteID = @id');
    if (!r.recordset.length) { await tx.rollback(); return res.status(404).json({ mensaje: 'Lote no encontrado.' }); }
    await refrescarResumen(tx, r.recordset[0].MedicamentoID);
    await tx.commit();
    await registrarAuditoria(pool, { tabla: 'LotesInventario', registroId: Number(req.params.id), accion: 'Actualizar', usuarioId: req.usuario.usuarioId,
      detalle: `Corrigió el lote #${req.params.id}: ${txt(req.body.numeroLote, 40) || 'sin número'}, vence ${vence || '—'}` });
    res.json({ mensaje: 'Lote actualizado.' });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo actualizar el lote.' });
  }
}

// POST /api/inventario/lotes/:id/baja  { motivo }  (Administrativo) — retira lo que queda (vencido, roto, cadena de frío rota)
async function bajaLote(req, res) {
  const motivo = String(req.body.motivo || '').trim().slice(0, 150);
  if (!motivo) return res.status(400).json({ mensaje: 'Indica el motivo de la baja (vencido, dañado, se rompió la cadena de frío…).' });
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const l = (await new sql.Request(tx).input('id', sql.Int, req.params.id)
      .query('SELECT LoteID, MedicamentoID, NumeroLote, CantidadActual FROM LotesInventario WITH (UPDLOCK) WHERE LoteID = @id')).recordset[0];
    if (!l) { await tx.rollback(); return res.status(404).json({ mensaje: 'Lote no encontrado.' }); }
    const c = Number(l.CantidadActual);
    if (!(c > 0)) { await tx.rollback(); return res.status(400).json({ mensaje: 'Ese lote ya no tiene unidades.' }); }
    const st = await new sql.Request(tx).input('m', sql.Int, l.MedicamentoID).input('c', sql.Decimal(10, 2), c)
      .query('UPDATE Medicamentos SET Stock = CASE WHEN Stock >= @c THEN Stock - @c ELSE 0 END OUTPUT INSERTED.Stock, INSERTED.NombreMedicamento, INSERTED.Unidad WHERE MedicamentoID = @m');
    const { Stock, NombreMedicamento, Unidad } = st.recordset[0];
    const mov = await new sql.Request(tx).input('m', sql.Int, l.MedicamentoID).input('c', sql.Decimal(10, 2), c).input('s', sql.Decimal(10, 2), Stock)
      .input('mo', sql.NVarChar, `Baja del lote ${l.NumeroLote || '#' + l.LoteID}: ${motivo}`.slice(0, 200)).input('u', sql.Int, req.usuario.usuarioId)
      .query("INSERT INTO MovimientosInventario (MedicamentoID, Tipo, Cantidad, StockResultante, Motivo, UsuarioID) OUTPUT INSERTED.MovimientoID VALUES (@m, 'Salida', @c, @s, @mo, @u)");
    await new sql.Request(tx).input('id', sql.Int, l.LoteID).query('UPDATE LotesInventario SET CantidadActual = 0 WHERE LoteID = @id');
    await new sql.Request(tx).input('id', sql.Int, l.LoteID).input('c', sql.Decimal(10, 2), c).input('mv', sql.Int, mov.recordset[0].MovimientoID)
      .query('INSERT INTO LotesSalidas (LoteID, Cantidad, MovimientoID) VALUES (@id, @c, @mv)');
    await refrescarResumen(tx, l.MedicamentoID);
    await tx.commit();
    await registrarAuditoria(pool, { tabla: 'Medicamentos', registroId: l.MedicamentoID, accion: 'Movimiento', usuarioId: req.usuario.usuarioId,
      detalle: `Dio de baja ${c} ${Unidad} de ${NombreMedicamento} (lote ${l.NumeroLote || '#' + l.LoteID}): ${motivo}` });
    res.json({ mensaje: `Se dieron de baja ${c} ${Unidad}.`, stock: Number(Stock) });
  } catch (err) {
    try { await tx.rollback(); } catch (_) { /* cerrada */ }
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo dar de baja el lote.' });
  }
}

// ------------------------------------------------------------------
// Solicitudes de reposición (todo el personal pide; el Administrativo compra)
// ------------------------------------------------------------------

// POST /api/inventario/solicitudes  { medicamentoId? | nombreProducto?, cantidad?, nota?, urgente? }
async function solicitar(req, res) {
  const b = req.body || {};
  const nombre = txt(b.nombreProducto, 150);
  const cantidad = num(b.cantidad);
  if (!b.medicamentoId && !nombre) return res.status(400).json({ mensaje: 'Indica qué producto se necesita.' });
  if (cantidad !== null && !(cantidad > 0 && cantidad <= 10000)) return res.status(400).json({ mensaje: 'La cantidad no es válida.' });
  try {
    const pool = await getPool();
    let medId = b.medicamentoId ? Number(b.medicamentoId) : null;
    let nombreFinal = nombre;
    if (medId) {
      const m = (await pool.request().input('id', sql.Int, medId).query('SELECT NombreMedicamento FROM Medicamentos WHERE MedicamentoID = @id AND Activo = 1')).recordset[0];
      if (!m) return res.status(400).json({ mensaje: 'El producto no existe en el inventario.' });
      nombreFinal = m.NombreMedicamento;
    } else {
      // Si el "producto nuevo" en realidad ya existe en el inventario, se enlaza
      const ya = (await pool.request().input('n', sql.NVarChar, nombre).query('SELECT MedicamentoID FROM Medicamentos WHERE NombreMedicamento = @n AND Activo = 1')).recordset[0];
      if (ya) medId = ya.MedicamentoID;
      else {
        const dup = (await pool.request().input('n', sql.NVarChar, nombre).query("SELECT 1 x FROM SolicitudesReposicion WHERE MedicamentoID IS NULL AND NombreProducto = @n AND Estado = 'Pendiente'")).recordset[0];
        if (dup) return res.status(409).json({ mensaje: 'Ese producto ya fue solicitado y está pendiente.' });
      }
    }
    const r = await pool.request()
      .input('m', sql.Int, medId).input('n', sql.NVarChar(150), medId ? null : nombreFinal).input('c', sql.Decimal(10, 2), cantidad)
      .input('nota', sql.NVarChar(300), txt(b.nota, 300)).input('urg', sql.Bit, b.urgente ? 1 : 0).input('u', sql.Int, req.usuario.usuarioId)
      .query(`INSERT INTO SolicitudesReposicion (MedicamentoID, NombreProducto, Cantidad, Nota, Urgente, UsuarioID)
              OUTPUT INSERTED.SolicitudID VALUES (@m, @n, @c, @nota, @urg, @u)`);
    await registrarAuditoria(pool, { tabla: 'SolicitudesReposicion', registroId: r.recordset[0].SolicitudID, accion: 'Crear', usuarioId: req.usuario.usuarioId,
      detalle: `Solicitó reponer ${nombreFinal}${cantidad ? ` (${cantidad})` : ''}${b.urgente ? ' — URGENTE' : ''}` });
    res.status(201).json({ mensaje: 'Solicitud enviada: el área administrativa la verá en el pedido sugerido.', solicitudId: r.recordset[0].SolicitudID });
  } catch (err) {
    if (err.number === 2601 || err.number === 2627) return res.status(409).json({ mensaje: 'Ese producto ya tiene una solicitud pendiente.' });
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo enviar la solicitud.' });
  }
}

// GET /api/inventario/solicitudes — pendientes (y las últimas atendidas del propio usuario)
async function listarSolicitudes(req, res) {
  try {
    const pool = await getPool();
    const r = await pool.request().input('u', sql.Int, req.usuario.usuarioId).query(`
      SELECT TOP 100 s.SolicitudID, s.MedicamentoID, ISNULL(m.NombreMedicamento, s.NombreProducto) AS Producto, s.Cantidad, s.Nota, s.Urgente,
             s.Estado, s.Fecha, s.FechaAtencion, s.CompraID, m.Stock, m.StockMinimo, m.Unidad,
             (per.Nombres + ' ' + per.Apellidos) AS Solicitante, s.UsuarioID
      FROM SolicitudesReposicion s
      LEFT JOIN Medicamentos m ON m.MedicamentoID = s.MedicamentoID
      INNER JOIN Usuarios u ON u.UsuarioID = s.UsuarioID INNER JOIN Personas per ON per.PersonaID = u.PersonaID
      WHERE s.Estado = 'Pendiente' OR (s.UsuarioID = @u AND s.FechaAtencion >= DATEADD(DAY, -15, DATEADD(HOUR, -5, SYSUTCDATETIME())))
      ORDER BY CASE WHEN s.Estado = 'Pendiente' THEN 0 ELSE 1 END, s.Urgente DESC, s.Fecha DESC`);
    res.json(r.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudieron cargar las solicitudes.' });
  }
}

// POST /api/inventario/solicitudes/:id/resolver  { estado: 'Atendida'|'Descartada' }
// Administrativo, o quien la hizo (solo para descartarla)
async function resolverSolicitud(req, res) {
  const estado = req.body.estado;
  if (!['Atendida', 'Descartada'].includes(estado)) return res.status(400).json({ mensaje: 'Estado inválido.' });
  try {
    const pool = await getPool();
    const s = (await pool.request().input('id', sql.Int, req.params.id).query("SELECT UsuarioID FROM SolicitudesReposicion WHERE SolicitudID = @id AND Estado = 'Pendiente'")).recordset[0];
    if (!s) return res.status(404).json({ mensaje: 'La solicitud no existe o ya fue resuelta.' });
    const propia = s.UsuarioID === req.usuario.usuarioId;
    if (!req.usuario.accesoConfig && !(propia && estado === 'Descartada')) return res.status(403).json({ mensaje: 'Solo el área administrativa puede resolver solicitudes.' });
    await pool.request().input('id', sql.Int, req.params.id).input('e', sql.NVarChar(12), estado).input('u', sql.Int, req.usuario.usuarioId)
      .query("UPDATE SolicitudesReposicion SET Estado = @e, AtendidaPor = @u, FechaAtencion = DATEADD(HOUR, -5, SYSUTCDATETIME()) WHERE SolicitudID = @id AND Estado = 'Pendiente'");
    await registrarAuditoria(pool, { tabla: 'SolicitudesReposicion', registroId: Number(req.params.id), accion: 'CambiarEstado', usuarioId: req.usuario.usuarioId, detalle: `Marcó la solicitud #${req.params.id} como ${estado}` });
    res.json({ mensaje: estado === 'Atendida' ? 'Solicitud atendida.' : 'Solicitud descartada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ mensaje: 'No se pudo actualizar la solicitud.' });
  }
}

module.exports = { listar, alertas, crear, actualizar, movimiento, movimientos, lotes, editarLote, bajaLote, solicitar, listarSolicitudes, resolverSolicitud, CATEGORIAS };
