/* ============================================================
   LIMPIEZA de datos de prueba antes de tu sustentación
   ============================================================
   Qué hace: borra TODOS los pacientes, propietarios, consultas,
   esquemas preventivos, citas y recordatorios — para que tu demo en
   vivo empiece desde cero, sin datos de prueba como "wdawd", "bob",
   "kaiser", Albert Spert, etc.

   Qué NO borra: tus usuarios de staff (Administrativo/Veterinario,
   incluido tu login de admin), ni los catálogos (Roles, tipos de
   esquema, medicamentos) — esos se quedan intactos.

   Cómo ejecutarlo: ábrelo en SSMS conectado a PremierCanDB y
   ejecútalo completo con F5.

   ⚠️ Esto SÍ borra datos de verdad y no se puede deshacer. Solo
   córrelo cuando ya no necesites los pacientes/clientes de prueba.
   ============================================================ */

USE PremierCanDB;
GO

-- El orden importa: primero las tablas "hijas" (las que dependen de
-- otras), al final las "padres" (Pacientes, Propietarios).

DELETE FROM ConsultaMedicamentos;
DELETE FROM ArchivosAdjuntos;
DELETE FROM Consultas;
DELETE FROM EsquemasPreventivos;
DELETE FROM Recordatorios;
DELETE FROM Citas;
DELETE FROM Pacientes;
DELETE FROM Propietarios;
GO

-- Reinicia los contadores de ID, para que el próximo paciente/cliente
-- que registres en tu demo empiece de nuevo en el ID 1 (más limpio de
-- mostrar en pantalla que un ID como "47").
DBCC CHECKIDENT ('Pacientes', RESEED, 0);
DBCC CHECKIDENT ('Propietarios', RESEED, 0);
DBCC CHECKIDENT ('Consultas', RESEED, 0);
DBCC CHECKIDENT ('EsquemasPreventivos', RESEED, 0);
DBCC CHECKIDENT ('Citas', RESEED, 0);
DBCC CHECKIDENT ('Recordatorios', RESEED, 0);
GO

-- Verificación: todas estas deben salir en 0.
SELECT
    (SELECT COUNT(*) FROM Pacientes)   AS Pacientes,
    (SELECT COUNT(*) FROM Propietarios) AS Propietarios,
    (SELECT COUNT(*) FROM Consultas)    AS Consultas,
    (SELECT COUNT(*) FROM Citas)        AS Citas,
    (SELECT COUNT(*) FROM Recordatorios) AS Recordatorios;
GO
