-- ============================================================
-- Premier Can - Gestión: auditoría completa, inventario, caja,
-- baño y peluquería, encuestas de satisfacción (2026-10-03)
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

-- ---------- 1) Auditoría: más acciones registrables ----------
DECLARE @ck SYSNAME = (SELECT name FROM sys.check_constraints
                       WHERE parent_object_id = OBJECT_ID('dbo.Auditoria') AND definition LIKE '%Accion%' AND definition NOT LIKE '%Anular%');
IF @ck IS NOT NULL
BEGIN
    EXEC('ALTER TABLE dbo.Auditoria DROP CONSTRAINT ' + @ck);
    ALTER TABLE dbo.Auditoria ADD CONSTRAINT CK_Auditoria_Accion CHECK (Accion IN
        ('Crear', 'Actualizar', 'Activar', 'Desactivar', 'Eliminar', 'CambiarEstado',
         'Aplicar', 'Subir', 'Cobrar', 'Anular', 'Cerrar', 'Movimiento', 'Enviar'));
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Auditoria_Fecha' AND object_id = OBJECT_ID('dbo.Auditoria'))
    CREATE INDEX IX_Auditoria_Fecha ON dbo.Auditoria (FechaHora DESC);
GO

-- ---------- 2) Inventario (sobre la tabla Medicamentos existente) ----------
IF COL_LENGTH('dbo.Medicamentos', 'Categoria') IS NULL
    ALTER TABLE dbo.Medicamentos ADD Categoria NVARCHAR(30) NOT NULL CONSTRAINT DF_Med_Categoria DEFAULT 'Medicamento'
        CONSTRAINT CK_Med_Categoria CHECK (Categoria IN ('Medicamento', 'Vacuna', 'Antiparasitario', 'Insumo', 'Alimento'));
IF COL_LENGTH('dbo.Medicamentos', 'Presentacion') IS NULL ALTER TABLE dbo.Medicamentos ADD Presentacion NVARCHAR(80) NULL;
IF COL_LENGTH('dbo.Medicamentos', 'Unidad') IS NULL ALTER TABLE dbo.Medicamentos ADD Unidad NVARCHAR(20) NOT NULL CONSTRAINT DF_Med_Unidad DEFAULT N'unid.';
IF COL_LENGTH('dbo.Medicamentos', 'Stock') IS NULL ALTER TABLE dbo.Medicamentos ADD Stock DECIMAL(10,2) NOT NULL CONSTRAINT DF_Med_Stock DEFAULT 0;
IF COL_LENGTH('dbo.Medicamentos', 'StockMinimo') IS NULL ALTER TABLE dbo.Medicamentos ADD StockMinimo DECIMAL(10,2) NOT NULL CONSTRAINT DF_Med_StockMin DEFAULT 0;
IF COL_LENGTH('dbo.Medicamentos', 'PrecioVenta') IS NULL ALTER TABLE dbo.Medicamentos ADD PrecioVenta DECIMAL(10,2) NULL;
IF COL_LENGTH('dbo.Medicamentos', 'Lote') IS NULL ALTER TABLE dbo.Medicamentos ADD Lote NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.Medicamentos', 'FechaVencimiento') IS NULL ALTER TABLE dbo.Medicamentos ADD FechaVencimiento DATE NULL;
IF COL_LENGTH('dbo.Medicamentos', 'ControlStock') IS NULL ALTER TABLE dbo.Medicamentos ADD ControlStock BIT NOT NULL CONSTRAINT DF_Med_Control DEFAULT 0;
IF COL_LENGTH('dbo.Medicamentos', 'Activo') IS NULL ALTER TABLE dbo.Medicamentos ADD Activo BIT NOT NULL CONSTRAINT DF_Med_Activo DEFAULT 1;
GO
IF OBJECT_ID('dbo.MovimientosInventario', 'U') IS NULL
CREATE TABLE dbo.MovimientosInventario (
    MovimientoID   INT IDENTITY(1,1) PRIMARY KEY,
    MedicamentoID  INT NOT NULL CONSTRAINT FK_Mov_Med REFERENCES dbo.Medicamentos(MedicamentoID),
    Tipo           NVARCHAR(10) NOT NULL CONSTRAINT CK_Mov_Tipo CHECK (Tipo IN ('Entrada', 'Salida', 'Ajuste')),
    Cantidad       DECIMAL(10,2) NOT NULL,           -- Ajuste: nuevo stock contado
    StockResultante DECIMAL(10,2) NOT NULL,
    Motivo         NVARCHAR(200) NULL,
    UsuarioID      INT NOT NULL CONSTRAINT FK_Mov_Usuario REFERENCES dbo.Usuarios(UsuarioID),
    Fecha          DATETIME2 NOT NULL CONSTRAINT DF_Mov_Fecha DEFAULT SYSDATETIME()
);
GO

-- ---------- 3) Caja diaria ----------
IF OBJECT_ID('dbo.Pagos', 'U') IS NULL
CREATE TABLE dbo.Pagos (
    PagoID          INT IDENTITY(1,1) PRIMARY KEY,
    Fecha           DATETIME2 NOT NULL CONSTRAINT DF_Pagos_Fecha DEFAULT DATEADD(HOUR, -5, SYSUTCDATETIME()),  -- hora de Perú
    Monto           DECIMAL(10,2) NOT NULL CONSTRAINT CK_Pagos_Monto CHECK (Monto > 0),
    MetodoPago      NVARCHAR(10) NOT NULL CONSTRAINT CK_Pagos_Metodo CHECK (MetodoPago IN ('Efectivo', 'Tarjeta', 'Yape', 'Plin')),
    Concepto        NVARCHAR(150) NOT NULL,
    PacienteID      INT NULL CONSTRAINT FK_Pagos_Paciente REFERENCES dbo.Pacientes(PacienteID),
    CitaID          INT NULL CONSTRAINT FK_Pagos_Cita REFERENCES dbo.Citas(CitaID),
    UsuarioID       INT NOT NULL CONSTRAINT FK_Pagos_Usuario REFERENCES dbo.Usuarios(UsuarioID),
    Anulado         BIT NOT NULL CONSTRAINT DF_Pagos_Anulado DEFAULT 0,
    MotivoAnulacion NVARCHAR(200) NULL,
    AnuladoPor      INT NULL CONSTRAINT FK_Pagos_Anulador REFERENCES dbo.Usuarios(UsuarioID)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Pagos_Fecha' AND object_id = OBJECT_ID('dbo.Pagos'))
    CREATE INDEX IX_Pagos_Fecha ON dbo.Pagos (Fecha);
GO
IF OBJECT_ID('dbo.CierresCaja', 'U') IS NULL
CREATE TABLE dbo.CierresCaja (
    CierreID        INT IDENTITY(1,1) PRIMARY KEY,
    Fecha           DATE NOT NULL CONSTRAINT UQ_Cierres_Fecha UNIQUE,
    TotalEfectivo   DECIMAL(10,2) NOT NULL,
    TotalTarjeta    DECIMAL(10,2) NOT NULL,
    TotalYape       DECIMAL(10,2) NOT NULL,
    TotalPlin       DECIMAL(10,2) NOT NULL,
    Total           DECIMAL(10,2) NOT NULL,
    EfectivoContado DECIMAL(10,2) NOT NULL,
    Diferencia      DECIMAL(10,2) NOT NULL,
    Observaciones   NVARCHAR(300) NULL,
    UsuarioID       INT NOT NULL CONSTRAINT FK_Cierres_Usuario REFERENCES dbo.Usuarios(UsuarioID),
    CreadoEn        DATETIME2 NOT NULL CONSTRAINT DF_Cierres_Creado DEFAULT SYSDATETIME()
);
GO

-- ---------- 4) Nuevo servicio: Baño y peluquería ----------
DECLARE @ckTipo SYSNAME = (SELECT name FROM sys.check_constraints
                           WHERE parent_object_id = OBJECT_ID('dbo.Citas') AND definition LIKE '%TipoCita%' AND definition NOT LIKE '%BanoPeluqueria%');
IF @ckTipo IS NOT NULL
BEGIN
    EXEC('ALTER TABLE dbo.Citas DROP CONSTRAINT ' + @ckTipo);
    ALTER TABLE dbo.Citas ADD CONSTRAINT CK_Citas_TipoCita
        CHECK (TipoCita IN ('Consulta', 'Vacunacion', 'CirugiaMenor', 'Urgencia', 'BanoPeluqueria'));
END
GO

-- ---------- 5) Encuestas de satisfacción ----------
IF OBJECT_ID('dbo.Encuestas', 'U') IS NULL
CREATE TABLE dbo.Encuestas (
    EncuestaID    INT IDENTITY(1,1) PRIMARY KEY,
    CitaID        INT NOT NULL CONSTRAINT UQ_Encuestas_Cita UNIQUE CONSTRAINT FK_Encuestas_Cita REFERENCES dbo.Citas(CitaID),
    PropietarioID INT NOT NULL CONSTRAINT FK_Encuestas_Propietario REFERENCES dbo.Propietarios(PropietarioID),
    Puntuacion    TINYINT NOT NULL CONSTRAINT CK_Encuestas_Puntuacion CHECK (Puntuacion BETWEEN 1 AND 5),
    Comentario    NVARCHAR(500) NULL,
    Fecha         DATETIME2 NOT NULL CONSTRAINT DF_Encuestas_Fecha DEFAULT SYSDATETIME()
);
GO
