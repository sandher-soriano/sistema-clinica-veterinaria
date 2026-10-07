-- ============================================================
-- Premier Can - DNI del personal obligatorio (2026-10-03)
-- Personas.NumeroDocumento pasa a NOT NULL + UNIQUE.
-- Si alguna persona no tiene DNI, se le pone uno provisional
-- (00000001, 00000002... según su PersonaID) que hay que reemplazar
-- por el real desde la pantalla "Personal".
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

UPDATE dbo.Personas
SET NumeroDocumento = RIGHT('0000000' + CAST(PersonaID AS VARCHAR(8)), 8)
WHERE NumeroDocumento IS NULL OR LTRIM(RTRIM(NumeroDocumento)) = '';
GO

-- El índice filtrado (versión anterior) impide cambiar la columna: se quita.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Personas_NumeroDocumento' AND object_id = OBJECT_ID('dbo.Personas'))
    DROP INDEX UX_Personas_NumeroDocumento ON dbo.Personas;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Personas') AND name = 'NumeroDocumento' AND is_nullable = 1)
    ALTER TABLE dbo.Personas ALTER COLUMN NumeroDocumento NVARCHAR(20) NOT NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints kc
    INNER JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE kc.parent_object_id = OBJECT_ID('dbo.Personas') AND kc.type = 'UQ' AND c.name = 'NumeroDocumento'
)
    ALTER TABLE dbo.Personas ADD CONSTRAINT UQ_Personas_NumeroDocumento UNIQUE (NumeroDocumento);
GO
