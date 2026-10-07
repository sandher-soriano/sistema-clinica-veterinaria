-- ============================================================
-- Premier Can - El cliente confirma o cancela su cita desde el portal/app (2026-10-03)
--  * ClienteConfirmo / ClienteConfirmoEn: el cliente avisó "asistiré".
--    (No cambia el Estado: "Confirmada" sigue siendo la confirmación de la CLÍNICA.)
--  * CanceladaPorCliente: la cancelación la hizo el propio cliente.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

IF COL_LENGTH('dbo.Citas', 'ClienteConfirmo') IS NULL
    ALTER TABLE dbo.Citas ADD ClienteConfirmo BIT NOT NULL CONSTRAINT DF_Citas_ClienteConfirmo DEFAULT 0;
GO
IF COL_LENGTH('dbo.Citas', 'ClienteConfirmoEn') IS NULL
    ALTER TABLE dbo.Citas ADD ClienteConfirmoEn DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.Citas', 'CanceladaPorCliente') IS NULL
    ALTER TABLE dbo.Citas ADD CanceladaPorCliente BIT NOT NULL CONSTRAINT DF_Citas_CanceladaPorCliente DEFAULT 0;
GO
