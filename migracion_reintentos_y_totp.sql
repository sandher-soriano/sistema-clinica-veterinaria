-- ============================================================
-- Premier Can - Límite de reintentos de correo y código 2FA de un solo uso (2026-10-03)
--  * Recordatorios.IntentosCorreo: cuántas veces falló el envío por correo.
--    Tras 5 fallos ya no se reintenta (antes: cada 15 min hasta vencer,
--    ~96 veces al día, gastando el cupo diario de Gmail). La app igual lo recibe.
--  * Usuarios.UltimoPasoTotp: último "paso" de 30 s del código 2FA ya usado.
--    Un mismo código de 6 dígitos no sirve dos veces (antes se podía
--    reutilizar dentro de su ventana de validez).
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

IF COL_LENGTH('dbo.Recordatorios', 'IntentosCorreo') IS NULL
    ALTER TABLE dbo.Recordatorios ADD IntentosCorreo INT NOT NULL
        CONSTRAINT DF_Recordatorios_IntentosCorreo DEFAULT 0;
GO

IF COL_LENGTH('dbo.Usuarios', 'UltimoPasoTotp') IS NULL
    ALTER TABLE dbo.Usuarios ADD UltimoPasoTotp BIGINT NULL;
GO
