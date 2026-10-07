-- ============================================================
-- Premier Can - Promociones (2026-09-27)
-- Promociones que publica el Administrativo y que ven los
-- clientes en el portal / app móvil (con notificación).
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

IF OBJECT_ID('dbo.Promociones', 'U') IS NULL
BEGIN
    CREATE TABLE Promociones (
        PromocionID        INT IDENTITY(1,1) PRIMARY KEY,
        Titulo             NVARCHAR(120)  NOT NULL,
        Etiqueta           NVARCHAR(30)   NULL,          -- ej. '-20%', '2x1', 'GRATIS'
        Categoria          NVARCHAR(40)   NULL,          -- ej. 'Vacunas', 'Baño y grooming'
        Descripcion        NVARCHAR(2000) NOT NULL,
        Condiciones        NVARCHAR(1000) NULL,          -- letra pequeña
        PrecioRegular      DECIMAL(10,2)  NULL,
        PrecioPromocion    DECIMAL(10,2)  NULL,
        FechaInicio        DATE           NOT NULL,      -- fecha literal de Perú
        FechaFin           DATE           NOT NULL,
        ImagenURL          NVARCHAR(300)  NULL,
        Activo             BIT            NOT NULL DEFAULT 1,
        CreadoPor          INT            NOT NULL,
        FechaCreacion      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        FechaActualizacion DATETIME2      NULL,
        CONSTRAINT FK_Promociones_Usuarios FOREIGN KEY (CreadoPor) REFERENCES Usuarios(UsuarioID),
        CONSTRAINT CK_Promociones_Fechas CHECK (FechaFin >= FechaInicio),
        CONSTRAINT CK_Promociones_Precios CHECK (PrecioPromocion IS NULL OR PrecioPromocion >= 0)
    );
    CREATE INDEX IX_Promociones_Vigencia ON Promociones (Activo, FechaInicio, FechaFin);
END
GO
