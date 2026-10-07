-- migracion_mascota_por_cliente.sql
-- El cliente puede registrar sus mascotas desde el portal. Quedan marcadas como
-- "registradas por el cliente" hasta que el personal revise sus datos (al editar
-- la ficha en Pacientes la marca se quita).
USE PremierCanDB;
GO
IF COL_LENGTH('dbo.Pacientes', 'RegistradoPorCliente') IS NULL
    ALTER TABLE dbo.Pacientes ADD RegistradoPorCliente BIT NOT NULL CONSTRAINT DF_Pac_RegCliente DEFAULT 0;
GO
