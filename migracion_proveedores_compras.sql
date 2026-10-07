-- migracion_proveedores_compras.sql
-- Abastecimiento del inventario, como se trabaja en las veterinarias de Perú:
--  - Proveedores (laboratorios, distribuidoras, droguerías) con RUC, contacto y
--    condición de pago (contado / crédito a N días).
--  - Compras con su comprobante (factura, boleta, guía): al registrarlas sube el
--    stock por LOTE con su vencimiento y costo.
--  - Lotes: el stock se descuenta primero del lote que vence antes (FEFO); así
--    las alertas de vencimiento reflejan lo que de verdad queda en el estante.
--  - Datos del producto: registro SENASA, laboratorio, proveedor habitual,
--    costo y si requiere cadena de frío.
-- Idempotente: se puede ejecutar varias veces.
USE PremierCanDB;
GO

-- ---------- 1) Proveedores ----------
IF OBJECT_ID('dbo.Proveedores', 'U') IS NULL
CREATE TABLE dbo.Proveedores (
    ProveedorID     INT IDENTITY(1,1) PRIMARY KEY,
    RUC             CHAR(11) NULL,
    RazonSocial     NVARCHAR(150) NOT NULL,
    NombreComercial NVARCHAR(100) NULL,
    Tipo            NVARCHAR(20) NOT NULL CONSTRAINT DF_Prov_Tipo DEFAULT 'Distribuidora'
                    CONSTRAINT CK_Prov_Tipo CHECK (Tipo IN ('Laboratorio', 'Distribuidora', 'Droguería', 'Otro')),
    Contacto        NVARCHAR(100) NULL,
    Telefono        NVARCHAR(20) NULL,
    Correo          NVARCHAR(120) NULL,
    Direccion       NVARCHAR(200) NULL,
    CondicionPago   NVARCHAR(10) NOT NULL CONSTRAINT DF_Prov_Cond DEFAULT 'Contado'
                    CONSTRAINT CK_Prov_Cond CHECK (CondicionPago IN ('Contado', 'Crédito')),
    DiasCredito     INT NOT NULL CONSTRAINT DF_Prov_Dias DEFAULT 0 CONSTRAINT CK_Prov_Dias CHECK (DiasCredito BETWEEN 0 AND 180),
    DiasEntrega     NVARCHAR(60) NULL,          -- ej. "Martes y viernes"
    Notas           NVARCHAR(500) NULL,
    Activo          BIT NOT NULL CONSTRAINT DF_Prov_Activo DEFAULT 1,
    FechaCreacion   DATETIME2 NOT NULL CONSTRAINT DF_Prov_Fecha DEFAULT DATEADD(HOUR, -5, SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Proveedores_RUC')
    CREATE UNIQUE INDEX UX_Proveedores_RUC ON dbo.Proveedores(RUC) WHERE RUC IS NOT NULL;
GO

-- ---------- 2) Datos de abastecimiento del producto ----------
IF COL_LENGTH('dbo.Medicamentos', 'ProveedorID') IS NULL
    ALTER TABLE dbo.Medicamentos ADD ProveedorID INT NULL CONSTRAINT FK_Med_Proveedor REFERENCES dbo.Proveedores(ProveedorID);
IF COL_LENGTH('dbo.Medicamentos', 'CostoUnitario') IS NULL
    ALTER TABLE dbo.Medicamentos ADD CostoUnitario DECIMAL(10,2) NULL CONSTRAINT CK_Med_Costo CHECK (CostoUnitario >= 0);
IF COL_LENGTH('dbo.Medicamentos', 'RegistroSenasa') IS NULL ALTER TABLE dbo.Medicamentos ADD RegistroSenasa NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.Medicamentos', 'Laboratorio') IS NULL ALTER TABLE dbo.Medicamentos ADD Laboratorio NVARCHAR(80) NULL;
IF COL_LENGTH('dbo.Medicamentos', 'Refrigerado') IS NULL
    ALTER TABLE dbo.Medicamentos ADD Refrigerado BIT NOT NULL CONSTRAINT DF_Med_Refrigerado DEFAULT 0;
GO
-- Las vacunas van en cadena de frío (2–8 °C)
UPDATE dbo.Medicamentos SET Refrigerado = 1 WHERE Categoria = 'Vacuna' AND Refrigerado = 0
  AND NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'LotesInventario');
GO

-- ---------- 3) Compras ----------
IF OBJECT_ID('dbo.Compras', 'U') IS NULL
CREATE TABLE dbo.Compras (
    CompraID             INT IDENTITY(1,1) PRIMARY KEY,
    ProveedorID          INT NOT NULL CONSTRAINT FK_Compras_Proveedor REFERENCES dbo.Proveedores(ProveedorID),
    TipoDocumento        NVARCHAR(20) NOT NULL CONSTRAINT CK_Compras_TipoDoc
                         CHECK (TipoDocumento IN ('Factura', 'Boleta', 'Guía de remisión', 'Sin comprobante')),
    NumeroDocumento      NVARCHAR(30) NULL,     -- serie-número, ej. F001-000123
    FechaEmision         DATE NOT NULL,
    CondicionPago        NVARCHAR(10) NOT NULL CONSTRAINT CK_Compras_Cond CHECK (CondicionPago IN ('Contado', 'Crédito')),
    FechaVencimientoPago DATE NULL,
    Total                DECIMAL(12,2) NOT NULL CONSTRAINT CK_Compras_Total CHECK (Total >= 0),
    EstadoPago           NVARCHAR(10) NOT NULL CONSTRAINT CK_Compras_Estado CHECK (EstadoPago IN ('Pendiente', 'Pagado')),
    FechaPago            DATE NULL,
    MetodoPago           NVARCHAR(20) NULL,
    Observaciones        NVARCHAR(300) NULL,
    Anulada              BIT NOT NULL CONSTRAINT DF_Compras_Anulada DEFAULT 0,
    MotivoAnulacion      NVARCHAR(200) NULL,
    UsuarioID            INT NOT NULL CONSTRAINT FK_Compras_Usuario REFERENCES dbo.Usuarios(UsuarioID),
    FechaRegistro        DATETIME2 NOT NULL CONSTRAINT DF_Compras_Fecha DEFAULT DATEADD(HOUR, -5, SYSUTCDATETIME())
);
GO
-- El mismo comprobante del mismo proveedor no se registra dos veces
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Compras_Documento')
    CREATE UNIQUE INDEX UX_Compras_Documento ON dbo.Compras(ProveedorID, TipoDocumento, NumeroDocumento)
    WHERE NumeroDocumento IS NOT NULL AND Anulada = 0;
GO

-- ---------- 4) Lotes ----------
IF OBJECT_ID('dbo.LotesInventario', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.LotesInventario (
        LoteID           INT IDENTITY(1,1) PRIMARY KEY,
        MedicamentoID    INT NOT NULL CONSTRAINT FK_Lotes_Med REFERENCES dbo.Medicamentos(MedicamentoID),
        NumeroLote       NVARCHAR(40) NULL,
        FechaVencimiento DATE NULL,
        CantidadInicial  DECIMAL(10,2) NOT NULL CONSTRAINT CK_Lotes_Inicial CHECK (CantidadInicial >= 0),
        CantidadActual   DECIMAL(10,2) NOT NULL CONSTRAINT CK_Lotes_Actual CHECK (CantidadActual >= 0),
        CostoUnitario    DECIMAL(10,2) NULL,
        CompraID         INT NULL CONSTRAINT FK_Lotes_Compra REFERENCES dbo.Compras(CompraID),
        Origen           NVARCHAR(20) NOT NULL CONSTRAINT DF_Lotes_Origen DEFAULT 'Compra',  -- Compra / Inicial / Entrada / Ajuste
        FechaIngreso     DATETIME2 NOT NULL CONSTRAINT DF_Lotes_Fecha DEFAULT DATEADD(HOUR, -5, SYSUTCDATETIME())
    );
    CREATE INDEX IX_Lotes_Med ON dbo.LotesInventario(MedicamentoID, CantidadActual) INCLUDE (FechaVencimiento);

    -- El stock que ya existía pasa a un lote inicial (con el lote/vencimiento que tenía el producto)
    INSERT INTO dbo.LotesInventario (MedicamentoID, NumeroLote, FechaVencimiento, CantidadInicial, CantidadActual, Origen)
    SELECT MedicamentoID, Lote, FechaVencimiento, Stock, Stock, 'Inicial'
    FROM dbo.Medicamentos WHERE ControlStock = 1 AND Stock > 0;
END
GO

IF OBJECT_ID('dbo.ComprasDetalle', 'U') IS NULL
CREATE TABLE dbo.ComprasDetalle (
    DetalleID        INT IDENTITY(1,1) PRIMARY KEY,
    CompraID         INT NOT NULL CONSTRAINT FK_CDet_Compra REFERENCES dbo.Compras(CompraID),
    MedicamentoID    INT NOT NULL CONSTRAINT FK_CDet_Med REFERENCES dbo.Medicamentos(MedicamentoID),
    Cantidad         DECIMAL(10,2) NOT NULL CONSTRAINT CK_CDet_Cant CHECK (Cantidad > 0),
    CostoUnitario    DECIMAL(10,2) NOT NULL CONSTRAINT CK_CDet_Costo CHECK (CostoUnitario >= 0),
    Subtotal         DECIMAL(12,2) NOT NULL,
    NumeroLote       NVARCHAR(40) NULL,
    FechaVencimiento DATE NULL,
    LoteID           INT NULL CONSTRAINT FK_CDet_Lote REFERENCES dbo.LotesInventario(LoteID)
);
GO

-- De qué lote salió cada salida (para devolverlo exacto si se anula)
IF OBJECT_ID('dbo.LotesSalidas', 'U') IS NULL
CREATE TABLE dbo.LotesSalidas (
    SalidaID      INT IDENTITY(1,1) PRIMARY KEY,
    LoteID        INT NOT NULL CONSTRAINT FK_LSal_Lote REFERENCES dbo.LotesInventario(LoteID),
    Cantidad      DECIMAL(10,2) NOT NULL CONSTRAINT CK_LSal_Cant CHECK (Cantidad > 0),
    PagoDetalleID INT NULL CONSTRAINT FK_LSal_PagoDet REFERENCES dbo.PagosDetalle(DetalleID),
    MovimientoID  INT NULL CONSTRAINT FK_LSal_Mov REFERENCES dbo.MovimientosInventario(MovimientoID)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LSal_PagoDet')
    CREATE INDEX IX_LSal_PagoDet ON dbo.LotesSalidas(PagoDetalleID) WHERE PagoDetalleID IS NOT NULL;
GO

-- ---------- 5) Auditoría: acción "Pagar" ----------
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Auditoria_Accion'
           AND definition NOT LIKE '%Pagar%')
BEGIN
    ALTER TABLE dbo.Auditoria DROP CONSTRAINT CK_Auditoria_Accion;
    ALTER TABLE dbo.Auditoria ADD CONSTRAINT CK_Auditoria_Accion CHECK (Accion IN
        ('Crear', 'Actualizar', 'Activar', 'Desactivar', 'Eliminar', 'CambiarEstado',
         'Aplicar', 'Subir', 'Cobrar', 'Anular', 'Cerrar', 'Movimiento', 'Enviar', 'Pagar'));
END
GO
