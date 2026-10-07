-- migracion_solicitudes_reposicion.sql
-- El personal (veterinarios incluidos) avisa desde Inventario que algo se acaba
-- o que necesita un producto que aún no se tiene. El administrativo lo ve en
-- "Pedido sugerido"; se marca "Atendida" sola al registrar la compra del producto.
USE PremierCanDB;
GO
IF OBJECT_ID('dbo.SolicitudesReposicion', 'U') IS NULL
CREATE TABLE dbo.SolicitudesReposicion (
    SolicitudID     INT IDENTITY(1,1) PRIMARY KEY,
    MedicamentoID   INT NULL CONSTRAINT FK_Sol_Med REFERENCES dbo.Medicamentos(MedicamentoID),
    NombreProducto  NVARCHAR(150) NULL,            -- producto que aún no está en el inventario
    Cantidad        DECIMAL(10,2) NULL CONSTRAINT CK_Sol_Cant CHECK (Cantidad > 0),
    Nota            NVARCHAR(300) NULL,
    Urgente         BIT NOT NULL CONSTRAINT DF_Sol_Urgente DEFAULT 0,
    Estado          NVARCHAR(12) NOT NULL CONSTRAINT DF_Sol_Estado DEFAULT 'Pendiente'
                    CONSTRAINT CK_Sol_Estado CHECK (Estado IN ('Pendiente', 'Atendida', 'Descartada')),
    UsuarioID       INT NOT NULL CONSTRAINT FK_Sol_Usuario REFERENCES dbo.Usuarios(UsuarioID),
    Fecha           DATETIME2 NOT NULL CONSTRAINT DF_Sol_Fecha DEFAULT DATEADD(HOUR, -5, SYSUTCDATETIME()),
    CompraID        INT NULL CONSTRAINT FK_Sol_Compra REFERENCES dbo.Compras(CompraID),
    AtendidaPor     INT NULL CONSTRAINT FK_Sol_Atendio REFERENCES dbo.Usuarios(UsuarioID),
    FechaAtencion   DATETIME2 NULL,
    CONSTRAINT CK_Sol_Producto CHECK (MedicamentoID IS NOT NULL OR NombreProducto IS NOT NULL)
);
GO
-- Una sola solicitud pendiente por producto (si ya se pidió, no se duplica)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Sol_PendientePorProducto')
    CREATE UNIQUE INDEX UX_Sol_PendientePorProducto ON dbo.SolicitudesReposicion(MedicamentoID)
    WHERE MedicamentoID IS NOT NULL AND Estado = 'Pendiente';
GO
