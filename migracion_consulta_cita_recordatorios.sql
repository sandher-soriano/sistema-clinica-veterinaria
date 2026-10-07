-- ============================================================
-- Premier Can - Consulta ligada a la cita + envío de recordatorios (2026-09-27)
--  1) Consultas.CitaID: la consulta registrada desde "Atender" queda
--     ligada a su cita (y una cita solo puede tener UNA consulta).
--  2) Recordatorios.CanalEnvio: por dónde se le avisó al cliente (correo
--     y/o app). La fecha del aviso va en la columna existente EnviadoEn.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.Consultas', 'CitaID') IS NULL
    ALTER TABLE dbo.Consultas ADD CitaID INT NULL
        CONSTRAINT FK_Consultas_Citas FOREIGN KEY REFERENCES dbo.Citas(CitaID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Consultas_CitaID' AND object_id = OBJECT_ID('dbo.Consultas'))
    CREATE UNIQUE INDEX UX_Consultas_CitaID ON dbo.Consultas (CitaID) WHERE CitaID IS NOT NULL;
GO

IF COL_LENGTH('dbo.Recordatorios', 'CanalEnvio') IS NULL
    ALTER TABLE dbo.Recordatorios ADD CanalEnvio NVARCHAR(30) NULL;  -- ej. 'Correo', 'App', 'Correo+App'
GO

-- 3) Recordatorios.Destino: 'Cliente' (se le envía al dueño por correo/app)
--    o 'Staff' (alerta interna, ej. "X solicitó una cita"): esas NUNCA se
--    le mandan al cliente.
IF COL_LENGTH('dbo.Recordatorios', 'Destino') IS NULL
    ALTER TABLE dbo.Recordatorios ADD Destino NVARCHAR(10) NOT NULL
        CONSTRAINT DF_Recordatorios_Destino DEFAULT 'Cliente'
        CONSTRAINT CK_Recordatorios_Destino CHECK (Destino IN ('Cliente', 'Staff'));
GO
UPDATE dbo.Recordatorios SET Destino = 'Staff'
WHERE Destino = 'Cliente' AND Mensaje LIKE N'%solicitó una cita%';
GO

-- 4) Recordatorio de cita: a qué cita corresponde (para no avisar dos veces)
IF COL_LENGTH('dbo.Recordatorios', 'CitaID') IS NULL
    ALTER TABLE dbo.Recordatorios ADD CitaID INT NULL
        CONSTRAINT FK_Recordatorios_Citas FOREIGN KEY REFERENCES dbo.Citas(CitaID);
GO

-- 5) Recordatorios de cita escalonados: 10 días, 3 días, 1 día y 5 horas antes.
--    Anticipacion = '10d' | '3d' | '1d' | '5h'. Un solo aviso por cita, hito y
--    fecha (si la cita se reprograma, los avisos se vuelven a generar).
IF COL_LENGTH('dbo.Recordatorios', 'Anticipacion') IS NULL
    ALTER TABLE dbo.Recordatorios ADD Anticipacion NVARCHAR(5) NULL;
GO
UPDATE dbo.Recordatorios SET Anticipacion = '1d'
WHERE CitaID IS NOT NULL AND Anticipacion IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Recordatorios_CitaHito' AND object_id = OBJECT_ID('dbo.Recordatorios'))
    CREATE UNIQUE INDEX UX_Recordatorios_CitaHito
        ON dbo.Recordatorios (CitaID, Anticipacion, FechaProgramada)
        WHERE CitaID IS NOT NULL;
GO
