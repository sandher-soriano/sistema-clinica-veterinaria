-- ============================================================
-- Premier Can - DNI del propietario opcional (2026-09-27)
-- La restricción UNIQUE sobre Propietarios.NumeroDocumento solo
-- permitía UN propietario sin DNI (SQL Server trata los NULL como
-- iguales en un UNIQUE). Se reemplaza por un índice único filtrado:
-- los DNI siguen sin poder repetirse, pero puede haber muchos NULL.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

DECLARE @uq SYSNAME = (
    SELECT kc.name
    FROM sys.key_constraints kc
    INNER JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE kc.parent_object_id = OBJECT_ID('dbo.Propietarios') AND kc.type = 'UQ' AND c.name = 'NumeroDocumento'
);
IF @uq IS NOT NULL
    EXEC('ALTER TABLE dbo.Propietarios DROP CONSTRAINT ' + @uq);
GO

-- Los índices filtrados exigen QUOTED_IDENTIFIER ON (sqlcmd lo trae apagado)
SET QUOTED_IDENTIFIER ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Propietarios_NumeroDocumento' AND object_id = OBJECT_ID('dbo.Propietarios'))
    CREATE UNIQUE INDEX UX_Propietarios_NumeroDocumento
        ON dbo.Propietarios (NumeroDocumento)
        WHERE NumeroDocumento IS NOT NULL;
GO
