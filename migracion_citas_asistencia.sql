-- ============================================================
-- Premier Can - Asistencia a citas (2026-09-28)
-- Una cita que ya pasó no puede quedarse "Programada": el personal la
-- cierra marcando si el cliente asistió (Completada) o no (NoAsistio).
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @ck SYSNAME = (
    SELECT name FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.Citas') AND definition LIKE '%Estado%'
      AND definition NOT LIKE '%NoAsistio%'
);
IF @ck IS NOT NULL
BEGIN
    EXEC('ALTER TABLE dbo.Citas DROP CONSTRAINT ' + @ck);
    ALTER TABLE dbo.Citas ADD CONSTRAINT CK_Citas_Estado
        CHECK (Estado IN ('Programada', 'Confirmada', 'Completada', 'Cancelada', 'NoAsistio'));
END
GO
