-- migracion_proveedores_sunat.sql
-- Estado del proveedor en SUNAT (consultado con "Buscar en SUNAT"):
-- ACTIVO/HABIDO = puede emitir facturas válidas; BAJA o NO HABIDO = alerta.
USE PremierCanDB;
GO
IF COL_LENGTH('dbo.Proveedores', 'EstadoSunat') IS NULL ALTER TABLE dbo.Proveedores ADD EstadoSunat NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.Proveedores', 'CondicionSunat') IS NULL ALTER TABLE dbo.Proveedores ADD CondicionSunat NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.Proveedores', 'VerificadoSunat') IS NULL ALTER TABLE dbo.Proveedores ADD VerificadoSunat DATETIME2 NULL;
GO
