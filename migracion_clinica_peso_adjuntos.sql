-- ============================================================
-- Premier Can - Peso/temperatura en consultas y adjuntos por mascota (2026-10-03)
--  * Consultas.PesoKg / TemperaturaC: signos registrados en cada consulta
--    (con ellos se arma el gráfico de evolución del peso).
--  * ArchivosAdjuntos: ahora pertenece a la MASCOTA (PacienteID) y la consulta
--    es opcional (un análisis puede llegar sin consulta). Se guarda quién lo
--    subió, el tamaño y una descripción. Los archivos van a una carpeta
--    PRIVADA (backend/privado/adjuntos): solo se descargan con sesión.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

IF COL_LENGTH('dbo.Consultas', 'PesoKg') IS NULL
    ALTER TABLE dbo.Consultas ADD PesoKg DECIMAL(6,2) NULL
        CONSTRAINT CK_Consultas_Peso CHECK (PesoKg IS NULL OR (PesoKg > 0 AND PesoKg <= 200));
GO
IF COL_LENGTH('dbo.Consultas', 'TemperaturaC') IS NULL
    ALTER TABLE dbo.Consultas ADD TemperaturaC DECIMAL(4,1) NULL
        CONSTRAINT CK_Consultas_Temperatura CHECK (TemperaturaC IS NULL OR (TemperaturaC BETWEEN 30 AND 45));
GO

IF COL_LENGTH('dbo.ArchivosAdjuntos', 'PacienteID') IS NULL
    ALTER TABLE dbo.ArchivosAdjuntos ADD PacienteID INT NULL
        CONSTRAINT FK_Adjuntos_Pacientes FOREIGN KEY REFERENCES dbo.Pacientes(PacienteID);
GO
-- La consulta pasa a ser opcional
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ArchivosAdjuntos') AND name = 'ConsultaID' AND is_nullable = 0)
    ALTER TABLE dbo.ArchivosAdjuntos ALTER COLUMN ConsultaID INT NULL;
GO
IF COL_LENGTH('dbo.ArchivosAdjuntos', 'Descripcion') IS NULL
    ALTER TABLE dbo.ArchivosAdjuntos ADD Descripcion NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.ArchivosAdjuntos', 'TamanoBytes') IS NULL
    ALTER TABLE dbo.ArchivosAdjuntos ADD TamanoBytes INT NULL;
GO
IF COL_LENGTH('dbo.ArchivosAdjuntos', 'SubidoPor') IS NULL
    ALTER TABLE dbo.ArchivosAdjuntos ADD SubidoPor INT NULL
        CONSTRAINT FK_Adjuntos_Usuarios FOREIGN KEY REFERENCES dbo.Usuarios(UsuarioID);
GO
-- Los adjuntos viejos (si hubiera) toman la mascota de su consulta
UPDATE a SET a.PacienteID = c.PacienteID
FROM dbo.ArchivosAdjuntos a INNER JOIN dbo.Consultas c ON c.ConsultaID = a.ConsultaID
WHERE a.PacienteID IS NULL;
GO
