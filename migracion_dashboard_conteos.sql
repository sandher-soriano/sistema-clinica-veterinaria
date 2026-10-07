-- ============================================================
-- Premier Can - Conteos correctos del Dashboard (2026-10-03)
--  * CitasHoy: con la fecha de HOY en Perú (no la del reloj del servidor de BD)
--    y sin contar las citas canceladas.
--  * VacunasPendientes: dosis por aplicar (FechaAplicacion IS NULL) de
--    mascotas ACTIVAS que ya están atrasadas o vencen en los próximos 30 días.
--    Antes contaba cada registro con estado Pendiente/Atrasado (también el
--    historial ya aplicado y las de mascotas inactivas), con números inflados.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

CREATE OR ALTER VIEW vw_ResumenDashboard AS
SELECT
    (SELECT COUNT(*) FROM Pacientes WHERE Activo = 1) AS TotalPacientes,
    (SELECT COUNT(*) FROM Citas
       WHERE CAST(FechaHora AS DATE) = CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE)
         AND Estado <> 'Cancelada') AS CitasHoy,
    (SELECT COUNT(*) FROM EsquemasPreventivos e
       INNER JOIN Pacientes p ON p.PacienteID = e.PacienteID AND p.Activo = 1
       WHERE e.FechaAplicacion IS NULL
         AND e.FechaProximaDosis <= DATEADD(DAY, 30, CAST(DATEADD(HOUR, -5, SYSUTCDATETIME()) AS DATE))) AS VacunasPendientes,
    -- EnviadoEn se guarda con SYSDATETIME() (reloj de esta PC, hora de Perú)
    (SELECT COUNT(*) FROM Recordatorios WHERE Estado = 'Enviado'
       AND CAST(EnviadoEn AS DATE) = CAST(SYSDATETIME() AS DATE)) AS RecordatoriosEnviadosHoy;
GO
