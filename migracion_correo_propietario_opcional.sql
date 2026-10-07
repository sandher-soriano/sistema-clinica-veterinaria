-- ============================================================
-- Premier Can - Correo del propietario opcional (2026-10-03)
-- La restricción UNIQUE sobre Propietarios.CorreoElectronico solo
-- permitía UN propietario sin correo (SQL Server trata los NULL como
-- iguales en un UNIQUE): el segundo dueño sin correo daba error.
-- Se reemplaza por un índice único filtrado: los correos siguen sin
-- poder repetirse, pero puede haber muchos propietarios sin correo.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

DECLARE @uq SYSNAME = (
    SELECT kc.name
    FROM sys.key_constraints kc
    INNER JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE kc.parent_object_id = OBJECT_ID('dbo.Propietarios') AND kc.type = 'UQ' AND c.name = 'CorreoElectronico'
);
IF @uq IS NOT NULL
    EXEC('ALTER TABLE dbo.Propietarios DROP CONSTRAINT ' + @uq);
GO

-- Correos vacíos ('') cuentan como "sin correo"
UPDATE dbo.Propietarios SET CorreoElectronico = NULL WHERE LTRIM(RTRIM(CorreoElectronico)) = '';
GO

SET QUOTED_IDENTIFIER ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Propietarios_CorreoElectronico' AND object_id = OBJECT_ID('dbo.Propietarios'))
    CREATE UNIQUE INDEX UX_Propietarios_CorreoElectronico
        ON dbo.Propietarios (CorreoElectronico)
        WHERE CorreoElectronico IS NOT NULL;
GO
