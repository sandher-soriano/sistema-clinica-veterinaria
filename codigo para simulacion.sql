USE PremierCanDB;
GO

-- ------------------------------------------------------------
-- 1) SIMULAR: pasaron más de 30 días desde que marcaste
--    "recordar este dispositivo" -> el próximo login SÍ debe
--    volver a pedir el código de 6 dígitos.
-- ------------------------------------------------------------
UPDATE DispositivosConfiables
SET ExpiraEn = DATEADD(DAY, -1, SYSDATETIME())   -- lo dejamos vencido "ayer"
WHERE UsuarioID = (SELECT UsuarioID FROM Usuarios WHERE NombreUsuario = 'admin');
GO

-- Prueba en el navegador: cierra sesión y vuelve a entrar con admin.
-- Aunque tengas el token guardado en localStorage, el backend ya no lo
-- encuentra vigente y te debe volver a pedir el código TOTP.


-- ------------------------------------------------------------
-- 2) SIMULAR: pasaron más de 90 días desde el último cambio de
--    contraseña -> el próximo login SÍ debe cortar y pedir que
--    la cambies antes de continuar.
-- ------------------------------------------------------------
UPDATE Usuarios
SET PasswordCambiadaEn = DATEADD(DAY, -91, SYSDATETIME())
WHERE NombreUsuario = 'admin';
GO

select*from Propietarios