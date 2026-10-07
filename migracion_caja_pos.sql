-- ============================================================
-- Premier Can - Caja como punto de venta (2026-10-03)
--  * Tarifas: precios de los servicios (consulta, vacunación, baño...).
--  * Promociones.DescuentoTipo / DescuentoValor: descuento que la promoción
--    aplica automáticamente en Caja (a los ítems de su categoría).
--  * Pagos: subtotal, descuento, promoción aplicada, motivo del descuento y
--    consulta cobrada (una consulta no se cobra dos veces: índice único).
--  * PagosDetalle: los ítems de cada cobro (servicios, productos del
--    inventario -que descuentan stock- y conceptos libres).
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

-- ---------- Tarifas de servicios ----------
IF OBJECT_ID('dbo.Tarifas', 'U') IS NULL
CREATE TABLE dbo.Tarifas (
    TarifaID  INT IDENTITY(1,1) PRIMARY KEY,
    Nombre    NVARCHAR(80) NOT NULL CONSTRAINT UQ_Tarifas_Nombre UNIQUE,
    Grupo     NVARCHAR(30) NOT NULL,          -- coincide con las categorías de Promociones
    TipoCita  NVARCHAR(20) NULL,              -- servicio que corresponde a cada tipo de cita
    Precio    DECIMAL(10,2) NOT NULL CONSTRAINT CK_Tarifas_Precio CHECK (Precio >= 0),
    Activo    BIT NOT NULL CONSTRAINT DF_Tarifas_Activo DEFAULT 1
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.Tarifas)
INSERT INTO dbo.Tarifas (Nombre, Grupo, TipoCita, Precio) VALUES
    (N'Consulta general',        N'Consultas',       'Consulta',       60),
    (N'Vacunación (aplicación)', N'Vacunas',         'Vacunacion',     20),
    (N'Desparasitación',         N'Desparasitación', NULL,             25),
    (N'Cirugía menor',           N'Cirugía',         'CirugiaMenor',  250),
    (N'Atención de urgencia',    N'Consultas',       'Urgencia',       90),
    (N'Baño y peluquería',       N'Baño y grooming', 'BanoPeluqueria', 35),
    (N'Análisis de laboratorio', N'Laboratorio',     NULL,             80);
GO

-- ---------- Descuento estructurado en las promociones ----------
IF COL_LENGTH('dbo.Promociones', 'DescuentoTipo') IS NULL
    ALTER TABLE dbo.Promociones ADD DescuentoTipo NVARCHAR(10) NULL
        CONSTRAINT CK_Promos_DescTipo CHECK (DescuentoTipo IN ('Porcentaje', 'Monto'));
IF COL_LENGTH('dbo.Promociones', 'DescuentoValor') IS NULL
    ALTER TABLE dbo.Promociones ADD DescuentoValor DECIMAL(10,2) NULL
        CONSTRAINT CK_Promos_DescValor CHECK (DescuentoValor IS NULL OR DescuentoValor > 0);
GO

-- ---------- Cobros con detalle, descuento y consulta ----------
IF COL_LENGTH('dbo.Pagos', 'Subtotal') IS NULL ALTER TABLE dbo.Pagos ADD Subtotal DECIMAL(10,2) NULL;
IF COL_LENGTH('dbo.Pagos', 'Descuento') IS NULL ALTER TABLE dbo.Pagos ADD Descuento DECIMAL(10,2) NOT NULL CONSTRAINT DF_Pagos_Descuento DEFAULT 0;
IF COL_LENGTH('dbo.Pagos', 'PromocionID') IS NULL ALTER TABLE dbo.Pagos ADD PromocionID INT NULL CONSTRAINT FK_Pagos_Promocion REFERENCES dbo.Promociones(PromocionID);
IF COL_LENGTH('dbo.Pagos', 'MotivoDescuento') IS NULL ALTER TABLE dbo.Pagos ADD MotivoDescuento NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.Pagos', 'ConsultaID') IS NULL ALTER TABLE dbo.Pagos ADD ConsultaID INT NULL CONSTRAINT FK_Pagos_Consulta REFERENCES dbo.Consultas(ConsultaID);
GO
-- Una consulta solo puede tener UN cobro vigente (los anulados no cuentan)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Pagos_ConsultaVigente' AND object_id = OBJECT_ID('dbo.Pagos'))
    CREATE UNIQUE INDEX UX_Pagos_ConsultaVigente ON dbo.Pagos (ConsultaID) WHERE ConsultaID IS NOT NULL AND Anulado = 0;
GO

IF OBJECT_ID('dbo.PagosDetalle', 'U') IS NULL
CREATE TABLE dbo.PagosDetalle (
    DetalleID      INT IDENTITY(1,1) PRIMARY KEY,
    PagoID         INT NOT NULL CONSTRAINT FK_Detalle_Pago REFERENCES dbo.Pagos(PagoID),
    Tipo           NVARCHAR(10) NOT NULL CONSTRAINT CK_Detalle_Tipo CHECK (Tipo IN ('Servicio', 'Producto', 'Libre')),
    TarifaID       INT NULL CONSTRAINT FK_Detalle_Tarifa REFERENCES dbo.Tarifas(TarifaID),
    MedicamentoID  INT NULL CONSTRAINT FK_Detalle_Medicamento REFERENCES dbo.Medicamentos(MedicamentoID),
    Descripcion    NVARCHAR(150) NOT NULL,
    Grupo          NVARCHAR(30) NULL,
    Cantidad       DECIMAL(10,2) NOT NULL CONSTRAINT CK_Detalle_Cantidad CHECK (Cantidad > 0),
    PrecioUnitario DECIMAL(10,2) NOT NULL CONSTRAINT CK_Detalle_Precio CHECK (PrecioUnitario >= 0),
    Subtotal       DECIMAL(10,2) NOT NULL,
    DescontoStock  BIT NOT NULL CONSTRAINT DF_Detalle_Stock DEFAULT 0   -- para devolverlo si se anula
);
GO
