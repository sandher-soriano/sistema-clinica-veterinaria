-- ============================================================
-- Premier Can - Avisos personalizados (2026-09-27)
-- Desde la pantalla de Recordatorios el personal puede mandar un
-- aviso propio ("Cerramos el lunes por feriado") a un cliente, a
-- todos, o solo a dueños de perros / gatos, por app, correo o ambos,
-- ahora o programado.
--   * TipoRecordatorio 'Aviso'
--   * PacienteID opcional (un aviso general no es de una mascota)
--   * Titulo: título propio del aviso
--   * EnviarPor: 'App' | 'Correo' | 'Ambos' (NULL = ambos)
--   * EnviarDesde: desde cuándo se envía (aviso programado o "Enviar ahora")
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

-- Tipo 'Aviso' en la restricción de TipoRecordatorio
DECLARE @ck SYSNAME = (
    SELECT name FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.Recordatorios') AND definition LIKE '%TipoRecordatorio%'
      AND definition NOT LIKE '%Aviso%'
);
IF @ck IS NOT NULL
BEGIN
    EXEC('ALTER TABLE dbo.Recordatorios DROP CONSTRAINT ' + @ck);
    ALTER TABLE dbo.Recordatorios ADD CONSTRAINT CK_Recordatorios_Tipo
        CHECK (TipoRecordatorio IN ('Vacuna', 'Desparasitacion', 'Cita', 'ControlGeneral', 'Aviso'));
END
GO

ALTER TABLE dbo.Recordatorios ALTER COLUMN PacienteID INT NULL;
GO

IF COL_LENGTH('dbo.Recordatorios', 'Titulo') IS NULL
    ALTER TABLE dbo.Recordatorios ADD Titulo NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.Recordatorios', 'EnviarPor') IS NULL
    ALTER TABLE dbo.Recordatorios ADD EnviarPor NVARCHAR(10) NULL
        CONSTRAINT CK_Recordatorios_EnviarPor CHECK (EnviarPor IN ('App', 'Correo', 'Ambos'));
GO
IF COL_LENGTH('dbo.Recordatorios', 'EnviarDesde') IS NULL
    ALTER TABLE dbo.Recordatorios ADD EnviarDesde DATETIME2 NULL;
GO

-- Bienvenida automática: se envía UNA vez, la primera vez que el cliente
-- inicia sesión en el portal / la app.
IF COL_LENGTH('dbo.Propietarios', 'BienvenidaEnviada') IS NULL
    ALTER TABLE dbo.Propietarios ADD BienvenidaEnviada BIT NOT NULL
        CONSTRAINT DF_Propietarios_Bienvenida DEFAULT 0;
GO
