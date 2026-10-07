/* ============================================================
   PREMIER CAN - Base de Datos (SQL Server)
   Sistema de gestión clínica veterinaria multiplataforma
   ============================================================
   Cómo ejecutarlo:
   1. Abre SQL Server Management Studio (SSMS).
   2. Conéctate a tu instancia local.
   3. Abre este archivo y ejecuta todo (F5).
   ============================================================ */

IF DB_ID('PremierCanDB') IS NULL
BEGIN
    CREATE DATABASE PremierCanDB;
END
GO

USE PremierCanDB;
GO

/* ============================================================
   1. ROLES
   Controla quién ve "Config" (Administrar Usuarios) en el front:
   - Administrativo -> SÍ tiene acceso a Config/Usuarios
   - Veterinario     -> NO tiene acceso a Config/Usuarios
   ============================================================ */
CREATE TABLE Roles (
    RolID           INT IDENTITY(1,1) PRIMARY KEY,
    NombreRol       NVARCHAR(30) NOT NULL UNIQUE,   -- 'Administrativo' | 'Veterinario'
    AccesoConfig    BIT NOT NULL DEFAULT 0            -- 1 = puede entrar a Config/Usuarios
);
GO

/* ============================================================
   2. USUARIOS (login del sistema web)
   ============================================================ */
CREATE TABLE Usuarios (
    UsuarioID           INT IDENTITY(1,1) PRIMARY KEY,
    NombreCompleto       NVARCHAR(120) NOT NULL,
    CorreoElectronico    NVARCHAR(150) NOT NULL UNIQUE,
    NombreUsuario        NVARCHAR(50)  NOT NULL UNIQUE,
    ContrasenaHash        NVARCHAR(255) NOT NULL,        -- guardar SIEMPRE con hash (bcrypt/argon2), nunca texto plano
    RolID                 INT NOT NULL,
    Activo                BIT NOT NULL DEFAULT 1,
    UltimoAcceso          DATETIME2 NULL,
    FechaCreacion         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Usuarios_Roles FOREIGN KEY (RolID) REFERENCES Roles(RolID)
);
GO

/* ============================================================
   3. PROPIETARIOS (dueños de mascotas / clientes de la app móvil)
   ============================================================ */
CREATE TABLE Propietarios (
    PropietarioID     INT IDENTITY(1,1) PRIMARY KEY,
    Nombres            NVARCHAR(100) NOT NULL,
    Apellidos          NVARCHAR(100) NOT NULL,
    Telefono           NVARCHAR(20)  NULL,
    CorreoElectronico  NVARCHAR(150) NULL UNIQUE,
    Direccion          NVARCHAR(200) NULL,
    ContrasenaHash     NVARCHAR(255) NULL,       -- solo si el propietario también inicia sesión en la app móvil
    FechaRegistro      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    Activo             BIT NOT NULL DEFAULT 1
);
GO

/* ============================================================
   4. PACIENTES (mascotas)
   ============================================================ */
CREATE TABLE Pacientes (
    PacienteID       INT IDENTITY(1,1) PRIMARY KEY,
    PropietarioID    INT NOT NULL,
    Nombre           NVARCHAR(100) NOT NULL,
    Especie          NVARCHAR(50)  NOT NULL,      -- 'Canino', 'Felino', etc.
    Raza             NVARCHAR(80)  NULL,
    FechaNacimiento  DATE NULL,
    Sexo             CHAR(1) NULL CHECK (Sexo IN ('M','H')),
    FotoURL          NVARCHAR(300) NULL,
    Alergias         NVARCHAR(500) NULL,
    Activo           BIT NOT NULL DEFAULT 1,
    FechaRegistro    DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Pacientes_Propietarios FOREIGN KEY (PropietarioID) REFERENCES Propietarios(PropietarioID)
);
GO

/* ============================================================
   5. CONSULTAS (historia clínica: cada visita/registro)
   ============================================================ */
CREATE TABLE Consultas (
    ConsultaID        INT IDENTITY(1,1) PRIMARY KEY,
    PacienteID        INT NOT NULL,
    VeterinarioID     INT NOT NULL,                -- FK a Usuarios (rol Veterinario)
    FechaConsulta     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    MotivoConsulta    NVARCHAR(200) NOT NULL,
    Sintomas          NVARCHAR(500) NULL,
    Diagnostico       NVARCHAR(500) NULL,
    Tratamiento       NVARCHAR(500) NULL,
    Observaciones     NVARCHAR(500) NULL,
    CreadoEn          DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Consultas_Pacientes FOREIGN KEY (PacienteID) REFERENCES Pacientes(PacienteID),
    CONSTRAINT FK_Consultas_Veterinario FOREIGN KEY (VeterinarioID) REFERENCES Usuarios(UsuarioID)
);
GO

/* ============================================================
   6. MEDICAMENTOS y detalle por consulta (N:M con dosis)
   ============================================================ */
CREATE TABLE Medicamentos (
    MedicamentoID    INT IDENTITY(1,1) PRIMARY KEY,
    NombreMedicamento NVARCHAR(120) NOT NULL UNIQUE
);
GO

CREATE TABLE ConsultaMedicamentos (
    ConsultaMedicamentoID INT IDENTITY(1,1) PRIMARY KEY,
    ConsultaID       INT NOT NULL,
    MedicamentoID    INT NOT NULL,
    Dosis            NVARCHAR(50)  NULL,
    Frecuencia       NVARCHAR(50)  NULL,
    DuracionDias     INT NULL,
    CONSTRAINT FK_CM_Consultas FOREIGN KEY (ConsultaID) REFERENCES Consultas(ConsultaID),
    CONSTRAINT FK_CM_Medicamentos FOREIGN KEY (MedicamentoID) REFERENCES Medicamentos(MedicamentoID)
);
GO

/* ============================================================
   7. ARCHIVOS ADJUNTOS (imágenes/documentos de una consulta)
   ============================================================ */
CREATE TABLE ArchivosAdjuntos (
    ArchivoID     INT IDENTITY(1,1) PRIMARY KEY,
    ConsultaID    INT NOT NULL,
    NombreArchivo NVARCHAR(200) NOT NULL,
    RutaArchivo   NVARCHAR(300) NOT NULL,
    TipoArchivo   NVARCHAR(50)  NULL,
    FechaSubida   DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Archivos_Consultas FOREIGN KEY (ConsultaID) REFERENCES Consultas(ConsultaID)
);
GO

/* ============================================================
   8. ESQUEMAS PREVENTIVOS (vacunación / desparasitación)
   ============================================================ */
CREATE TABLE TiposEsquemaPreventivo (
    TipoEsquemaID   INT IDENTITY(1,1) PRIMARY KEY,
    NombreTipo      NVARCHAR(50) NOT NULL UNIQUE   -- 'Vacuna', 'Desparasitación'
);
GO

CREATE TABLE EsquemasPreventivos (
    EsquemaID          INT IDENTITY(1,1) PRIMARY KEY,
    PacienteID         INT NOT NULL,
    TipoEsquemaID      INT NOT NULL,
    NombreProducto     NVARCHAR(120) NOT NULL,     -- ej. "Vacuna Antirrábica", "Desparasitante X"
    FechaAplicacion    DATE NOT NULL,
    FechaProximaDosis  DATE NULL,
    Estado             NVARCHAR(20) NOT NULL DEFAULT 'AlDia'
                        CHECK (Estado IN ('AlDia','Pendiente','Atrasado')),
    VeterinarioID      INT NULL,
    Observaciones      NVARCHAR(300) NULL,
    CONSTRAINT FK_Esquemas_Pacientes FOREIGN KEY (PacienteID) REFERENCES Pacientes(PacienteID),
    CONSTRAINT FK_Esquemas_Tipo FOREIGN KEY (TipoEsquemaID) REFERENCES TiposEsquemaPreventivo(TipoEsquemaID),
    CONSTRAINT FK_Esquemas_Veterinario FOREIGN KEY (VeterinarioID) REFERENCES Usuarios(UsuarioID)
);
GO

/* ============================================================
   9. CITAS
   ============================================================ */
CREATE TABLE Citas (
    CitaID          INT IDENTITY(1,1) PRIMARY KEY,
    PacienteID      INT NOT NULL,
    PropietarioID   INT NOT NULL,
    VeterinarioID   INT NULL,
    FechaHora       DATETIME2 NOT NULL,
    Motivo          NVARCHAR(200) NULL,
    TipoCita        NVARCHAR(30) NOT NULL DEFAULT 'Consulta'
                     CHECK (TipoCita IN ('Consulta','Vacunacion','CirugiaMenor','Urgencia')),
    Estado          NVARCHAR(20) NOT NULL DEFAULT 'Programada'
                     CHECK (Estado IN ('Programada','Confirmada','Completada','Cancelada')),
    CreadoEn        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Citas_Pacientes FOREIGN KEY (PacienteID) REFERENCES Pacientes(PacienteID),
    CONSTRAINT FK_Citas_Propietarios FOREIGN KEY (PropietarioID) REFERENCES Propietarios(PropietarioID),
    CONSTRAINT FK_Citas_Veterinario FOREIGN KEY (VeterinarioID) REFERENCES Usuarios(UsuarioID)
);
GO

/* ============================================================
   10. RECORDATORIOS (notificaciones automáticas)
   ============================================================ */
CREATE TABLE Recordatorios (
    RecordatorioID     INT IDENTITY(1,1) PRIMARY KEY,
    PacienteID         INT NOT NULL,
    PropietarioID      INT NOT NULL,
    TipoRecordatorio   NVARCHAR(30) NOT NULL
                        CHECK (TipoRecordatorio IN ('Vacuna','Desparasitacion','Cita','ControlGeneral')),
    FechaProgramada    DATETIME2 NOT NULL,
    Canal              NVARCHAR(20) NOT NULL DEFAULT 'Push'
                        CHECK (Canal IN ('Push','Email','SMS')),
    Estado             NVARCHAR(20) NOT NULL DEFAULT 'Pendiente'
                        CHECK (Estado IN ('Pendiente','Enviado','Fallido')),
    Mensaje            NVARCHAR(300) NULL,
    CreadoEn           DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    EnviadoEn          DATETIME2 NULL,
    CONSTRAINT FK_Recordatorios_Pacientes FOREIGN KEY (PacienteID) REFERENCES Pacientes(PacienteID),
    CONSTRAINT FK_Recordatorios_Propietarios FOREIGN KEY (PropietarioID) REFERENCES Propietarios(PropietarioID)
);
GO

-- Reglas de envío automático (ej. "enviar 3 días antes de la próxima dosis")
CREATE TABLE ReglasRecordatorioAutomatico (
    ReglaID            INT IDENTITY(1,1) PRIMARY KEY,
    TipoRecordatorio   NVARCHAR(30) NOT NULL
                        CHECK (TipoRecordatorio IN ('Vacuna','Desparasitacion','Cita','ControlGeneral')),
    DiasAntes          INT NOT NULL DEFAULT 3,
    Activo             BIT NOT NULL DEFAULT 1
);
GO

/* ============================================================
   11. ÍNDICES recomendados (consultas frecuentes del dashboard)
   ============================================================ */
CREATE INDEX IX_Pacientes_Propietario ON Pacientes(PropietarioID);
CREATE INDEX IX_Consultas_Paciente ON Consultas(PacienteID);
CREATE INDEX IX_Esquemas_Paciente_Estado ON EsquemasPreventivos(PacienteID, Estado);
CREATE INDEX IX_Citas_FechaHora ON Citas(FechaHora);
CREATE INDEX IX_Recordatorios_Estado_Fecha ON Recordatorios(Estado, FechaProgramada);
GO

/* ============================================================
   12. DATOS INICIALES (seed)
   ============================================================ */

-- Roles: solo "Administrativo" puede ver Config/Usuarios
INSERT INTO Roles (NombreRol, AccesoConfig) VALUES
    ('Administrativo', 1),
    ('Veterinario', 0);
GO

-- Tipos de esquema preventivo
INSERT INTO TiposEsquemaPreventivo (NombreTipo) VALUES
    ('Vacuna'),
    ('Desparasitación');
GO

-- Usuario administrador inicial
-- IMPORTANTE: 'ContrasenaHash' de ejemplo aquí es texto plano solo para que puedas
-- probar el login. En tu backend real, genera el hash con bcrypt/argon2 ANTES
-- de insertar, y nunca guardes contraseñas en texto plano.
INSERT INTO Usuarios (NombreCompleto, CorreoElectronico, NombreUsuario, ContrasenaHash, RolID, Activo)
VALUES ('Administrador Premier Can', 'admin@premiercan.com', 'admin',
        '$2b$12$REEMPLAZAR_CON_HASH_REAL', 1, 1);

INSERT INTO Usuarios (NombreCompleto, CorreoElectronico, NombreUsuario, ContrasenaHash, RolID, Activo)
VALUES ('Dra. Veterinaria Demo', 'veterinaria@premiercan.com', 'vet.demo',
        '$2b$12$REEMPLAZAR_CON_HASH_REAL', 2, 1);
GO

/* ============================================================
   13. VISTA de apoyo para el Dashboard (tarjetas resumen)
   ============================================================ */
CREATE VIEW vw_ResumenDashboard AS
SELECT
    (SELECT COUNT(*) FROM Pacientes WHERE Activo = 1)                                   AS TotalPacientes,
    (SELECT COUNT(*) FROM Citas WHERE CAST(FechaHora AS DATE) = CAST(SYSDATETIME() AS DATE)) AS CitasHoy,
    (SELECT COUNT(*) FROM EsquemasPreventivos WHERE Estado IN ('Pendiente','Atrasado'))  AS VacunasPendientes,
    (SELECT COUNT(*) FROM Recordatorios WHERE Estado = 'Enviado'
        AND CAST(EnviadoEn AS DATE) = CAST(SYSDATETIME() AS DATE))                       AS RecordatoriosEnviadosHoy;
GO



/*
Este cambio ya fue aplicado:*/
USE PremierCanDB;
GO

ALTER TABLE EsquemasPreventivos
ALTER COLUMN FechaAplicacion DATE NULL;
GO

/* 
Este codigo ya se corrio
============================================================
   MIGRACIÓN: Autenticación en dos pasos (2FA) para Administrativo
   + recuperación de contraseña con enlace por correo
   ============================================================
   Cómo ejecutarlo: ábrelo en SSMS conectado a PremierCanDB y
   ejecútalo completo con F5. Es seguro correrlo aunque ya tengas
   usuarios — no borra ni modifica filas existentes, solo agrega
   columnas nuevas (quedan NULL/0 para los usuarios que ya existen).
   ============================================================ */

USE PremierCanDB;
GO

ALTER TABLE Usuarios ADD
    TotpSecret        NVARCHAR(255) NULL,        -- clave secreta del autenticador (Google Authenticator, etc.)
    TotpHabilitado    BIT NOT NULL DEFAULT 0,     -- 1 = ya configuró su autenticador
    ResetTokenHash    NVARCHAR(255) NULL,         -- hash del token de "olvidé mi contraseña" vigente
    ResetTokenExpira  DATETIME2 NULL;             -- vencimiento de ese token
GO

-- Verificación: deben aparecer las 4 columnas nuevas.
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Usuarios'
  AND COLUMN_NAME IN ('TotpSecret', 'TotpHabilitado', 'ResetTokenHash', 'ResetTokenExpira');
GO

/* 
Este cambio ya fue hecho
============================================================
   MIGRACIÓN: "Olvidé mi contraseña" para CLIENTES (Propietarios)
   ============================================================
   Qué hace: agrega a la tabla Propietarios las mismas 2 columnas que
   ya le agregamos a Usuarios (el staff) para poder resetear la
   contraseña con un enlace por correo. Los clientes NO usan
   verificación en dos pasos (2FA) — eso es solo para Administrativo.

   Cómo ejecutarlo: ábrelo en SSMS conectado a PremierCanDB y
   ejecútalo completo con F5. Seguro correrlo aunque ya tengas datos.
   ============================================================ */

USE PremierCanDB;
GO

ALTER TABLE Propietarios ADD
    ResetTokenHash    NVARCHAR(255) NULL,
    ResetTokenExpira  DATETIME2 NULL;
GO

-- Verificación: deben aparecer las 2 columnas nuevas.
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Propietarios'
  AND COLUMN_NAME IN ('ResetTokenHash', 'ResetTokenExpira');
GO

/* 
Ultimo cambio
============================================================
   MIGRACIÓN: obligar cambio de contraseña temporal (clientes)
   ============================================================
   Cuando el admin genera una contraseña temporal para un cliente
   (botón de la llave 🔑 en Pacientes), esta columna queda en 1.
   El cliente no puede usar el resto del portal hasta que la cambie
   por una propia, la primera vez que inicia sesión.

   Cómo ejecutarlo: ábrelo en SSMS conectado a PremierCanDB y
   ejecútalo completo con F5. Seguro correrlo aunque ya tengas datos.
   ============================================================ */

USE PremierCanDB;
GO

ALTER TABLE Propietarios ADD
    DebeCambiarPassword BIT NOT NULL DEFAULT 0;
GO

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Propietarios' AND COLUMN_NAME = 'DebeCambiarPassword';
GO


/*
Lo ultimo
============================================================
   MIGRACIÓN: método de pago informativo en Citas
   ============================================================
   No procesa ningún cobro real, solo registra qué método prefiere
   o usó el cliente (Efectivo, Tarjeta, Yape, Plin) para referencia
   del staff.

   Cómo ejecutarlo: ábrelo en SSMS conectado a PremierCanDB y
   ejecútalo completo con F5. Seguro correrlo aunque ya tengas datos.
   ============================================================ */

USE PremierCanDB;
GO

ALTER TABLE Citas ADD
    MetodoPago NVARCHAR(20) NULL
        CHECK (MetodoPago IN ('Efectivo','Tarjeta','Yape','Plin'));
GO

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Citas' AND COLUMN_NAME = 'MetodoPago';
GO


/* Ultimo Cambio Hecho
============================================================
   MIGRACIÓN: Dispositivo de confianza + vigencia de contraseña
   (correcciones pedidas por el ingeniero en la revisión de avance)
   ============================================================
   1) DispositivosConfiables: si el usuario Administrativo marca
      "recordar este dispositivo" al validar el doble factor, no se le
      vuelve a pedir el código TOTP desde ese mismo navegador mientras
      el token no venza (30 días). Si entra desde otra PC o en modo
      incógnito, no hay token guardado y sí le vuelve a pedir el doble
      factor.
   2) PasswordCambiadaEn + ConfiguracionSeguridad.VigenciaClaveDias:
      el admin define cada cuántos días vence la contraseña (90/60/30).
      Al vencer, se obliga a cambiarla, y ese cambio además elimina los
      dispositivos de confianza ya guardados (se vuelve a pedir el
      doble factor, tal como se pidió en la revisión).

   Cómo ejecutarlo: ábrelo en SSMS conectado a PremierCanDB y
   ejecútalo completo con F5. Seguro correrlo aunque ya tengas datos.
   ============================================================ */

USE PremierCanDB;
GO

ALTER TABLE Usuarios ADD
    PasswordCambiadaEn DATETIME2 NOT NULL DEFAULT SYSDATETIME();
GO

CREATE TABLE ConfiguracionSeguridad (
    ConfiguracionID     INT IDENTITY(1,1) PRIMARY KEY,
    VigenciaClaveDias   INT NOT NULL DEFAULT 90   -- lo puede cambiar el Administrativo: 90, 60 o 30
);
GO

INSERT INTO ConfiguracionSeguridad (VigenciaClaveDias) VALUES (90);
GO

CREATE TABLE DispositivosConfiables (
    DispositivoID   INT IDENTITY(1,1) PRIMARY KEY,
    UsuarioID       INT NOT NULL,
    TokenHash       NVARCHAR(255) NOT NULL,   -- nunca se guarda el token en texto plano (igual que ResetTokenHash)
    DireccionIP     NVARCHAR(50) NULL,        -- referencia de auditoría: desde qué IP se confió el dispositivo
    CreadoEn        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    ExpiraEn        DATETIME2 NOT NULL,       -- CreadoEn + 30 días
    CONSTRAINT FK_Dispositivos_Usuarios FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID)
);
GO

CREATE INDEX IX_Dispositivos_Usuario ON DispositivosConfiables(UsuarioID);
GO

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Usuarios' AND COLUMN_NAME = 'PasswordCambiadaEn';
GO


/*
============================================================
   MIGRACIÓN: separar los datos de PERSONA del USUARIO de sistema
   ============================================================
   Esto es lo que el ingeniero señaló como "el mismo error de Vega":
   la tabla Usuarios tenía NombreCompleto y CorreoElectronico propios,
   en vez de heredarlos de una tabla Persona ya existente.

   - Personas: datos del personal contratado (veterinarios y
     administrativos), independientemente de si ya tienen o no acceso
     al sistema.
   - Usuarios pasa a tener PersonaID (1 Persona = como máximo 1
     Usuario) en vez de NombreCompleto/CorreoElectronico propios.
   - Los Propietarios (clientes) NO se tocan: en su caso la fila de
     Propietarios YA ES la persona completa, no hace falta separarla.

   Cómo ejecutarlo: ábrelo en SSMS conectado a PremierCanDB y
   ejecútalo completo con F5. Migra automáticamente a tus usuarios
   existentes (admin, vet.demo, etc.) como Personas.
   ============================================================ */

USE PremierCanDB;
GO

CREATE TABLE Personas (
    PersonaID          INT IDENTITY(1,1) PRIMARY KEY,
    Nombres            NVARCHAR(100) NOT NULL,
    Apellidos          NVARCHAR(100) NOT NULL,
    NumeroDocumento    NVARCHAR(20)  NOT NULL UNIQUE, -- DNI (obligatorio)
    Telefono           NVARCHAR(20)  NULL,
    CorreoElectronico  NVARCHAR(150) NOT NULL UNIQUE,
    Direccion          NVARCHAR(200) NULL,
    Activo             BIT NOT NULL DEFAULT 1,
    FechaRegistro      DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO

-- Migra cada Usuario existente a una fila de Personas (separa nombre y
-- apellido por el primer espacio; es una aproximación simple para tus
-- usuarios de prueba — revísalos después en la pantalla "Personal").
-- El DNI es obligatorio: se pone uno provisional (00000001, 00000002...)
-- que hay que reemplazar por el real desde "Personal".
INSERT INTO Personas (NumeroDocumento, Nombres, Apellidos, CorreoElectronico)
SELECT
    RIGHT('0000000' + CAST(UsuarioID AS VARCHAR(8)), 8) AS NumeroDocumento,
    LEFT(NombreCompleto, CASE WHEN CHARINDEX(' ', NombreCompleto) = 0 THEN LEN(NombreCompleto) ELSE CHARINDEX(' ', NombreCompleto) - 1 END) AS Nombres,
    CASE WHEN CHARINDEX(' ', NombreCompleto) = 0 THEN '(sin apellido)'
         ELSE LTRIM(SUBSTRING(NombreCompleto, CHARINDEX(' ', NombreCompleto) + 1, LEN(NombreCompleto))) END AS Apellidos,
    CorreoElectronico
FROM Usuarios;
GO

ALTER TABLE Usuarios ADD PersonaID INT NULL;
GO

UPDATE u
SET u.PersonaID = p.PersonaID
FROM Usuarios u
INNER JOIN Personas p ON p.CorreoElectronico = u.CorreoElectronico;
GO

ALTER TABLE Usuarios ALTER COLUMN PersonaID INT NOT NULL;
GO

ALTER TABLE Usuarios ADD CONSTRAINT FK_Usuarios_Personas FOREIGN KEY (PersonaID) REFERENCES Personas(PersonaID);
GO

-- Una Persona no puede tener más de un Usuario de sistema.
ALTER TABLE Usuarios ADD CONSTRAINT UQ_Usuarios_PersonaID UNIQUE (PersonaID);
GO

-- El UNIQUE de CorreoElectronico en Usuarios tiene un nombre autogenerado
-- por SQL Server, así que hay que buscarlo antes de poder borrar la columna.
DECLARE @NombreConstraint NVARCHAR(200);
SELECT @NombreConstraint = kc.name
FROM sys.key_constraints kc
INNER JOIN sys.tables t ON t.object_id = kc.parent_object_id
INNER JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE t.name = 'Usuarios' AND c.name = 'CorreoElectronico' AND kc.type = 'UQ';

IF @NombreConstraint IS NOT NULL
    EXEC('ALTER TABLE Usuarios DROP CONSTRAINT ' + @NombreConstraint);
GO

-- Ya no se necesitan: ahora viven en Personas.
ALTER TABLE Usuarios DROP COLUMN CorreoElectronico, NombreCompleto;
GO

-- Verificación: revisa que cada usuario haya quedado bien migrado.
SELECT PersonaID, Nombres, Apellidos, CorreoElectronico FROM Personas;
SELECT UsuarioID, PersonaID, NombreUsuario FROM Usuarios;
GO

select*from Usuarios
select*from Personas
select*from Propietarios

select*from Usuarios
select*from Personas

/*
============================================================
   MIGRACIÓN: DNI de propietarios (RENIEC) + activar/desactivar
   pacientes + auditoría de Pacientes
   ============================================================
   1) Propietarios: NumeroDocumento (DNI) + DniValidado, para poder
      validarlo contra una API pública de RENIEC al registrar un
      propietario nuevo.
   2) Auditoria: tabla genérica que guarda quién hizo qué y cuándo.
      Por ahora se usa para Pacientes (crear/editar/activar/
      desactivar), pero está pensada para reusarse en otros módulos.
   ============================================================ */

USE PremierCanDB;
GO

ALTER TABLE Propietarios ADD
    NumeroDocumento NVARCHAR(8) NULL UNIQUE,   -- DNI, 8 dígitos
    DniValidado     BIT NOT NULL DEFAULT 0;    -- 1 = confirmado contra RENIEC
GO

CREATE TABLE Auditoria (
    AuditoriaID    INT IDENTITY(1,1) PRIMARY KEY,
    TablaAfectada  NVARCHAR(50) NOT NULL,        -- ej. 'Pacientes'
    RegistroID     INT NOT NULL,                  -- PK del registro afectado
    Accion         NVARCHAR(20) NOT NULL
                   CHECK (Accion IN ('Crear','Actualizar','Activar','Desactivar')),
    UsuarioID      INT NOT NULL,                  -- quién lo hizo
    Detalle        NVARCHAR(500) NULL,
    FechaHora      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_Auditoria_Usuarios FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID)
);
GO

CREATE INDEX IX_Auditoria_Tabla_Registro ON Auditoria(TablaAfectada, RegistroID);
GO

-- Verificación
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Propietarios' AND COLUMN_NAME IN ('NumeroDocumento', 'DniValidado');

SELECT * FROM Auditoria;
GO


/*
============================================================
   MIGRACIÓN: Ubigeo (Departamento/Provincia/Distrito) +
   Fecha de nacimiento en Personas
   ============================================================
   Datos oficiales de UBIGEO (INEI, actualizado a 2016), tomados de
   un dataset público: 24 departamentos, 195 provincias, 1873
   distritos. Con esto la dirección de Personas y Propietarios se
   arma eligiendo Departamento -> Provincia -> Distrito (en cascada),
   en vez de escribirla libre. El campo Direccion se mantiene para
   el detalle (calle, número, referencia).
   ============================================================ */

USE PremierCanDB;
GO

CREATE TABLE Departamentos (
    CodigoDepartamento CHAR(2) PRIMARY KEY,
    Nombre NVARCHAR(60) NOT NULL
);
GO

CREATE TABLE Provincias (
    CodigoProvincia    CHAR(4) PRIMARY KEY,
    Nombre             NVARCHAR(60) NOT NULL,
    CodigoDepartamento CHAR(2) NOT NULL,
    CONSTRAINT FK_Provincias_Departamentos FOREIGN KEY (CodigoDepartamento) REFERENCES Departamentos(CodigoDepartamento)
);
GO

CREATE TABLE Distritos (
    CodigoDistrito     CHAR(6) PRIMARY KEY,
    Nombre             NVARCHAR(60) NOT NULL,
    CodigoProvincia    CHAR(4) NOT NULL,
    CodigoDepartamento CHAR(2) NOT NULL,
    CONSTRAINT FK_Distritos_Provincias FOREIGN KEY (CodigoProvincia) REFERENCES Provincias(CodigoProvincia)
);
GO

CREATE INDEX IX_Provincias_Departamento ON Provincias(CodigoDepartamento);
CREATE INDEX IX_Distritos_Provincia ON Distritos(CodigoProvincia);
GO

-- ------------------------------------------------------------
-- Datos del catálogo (INEI 2016)
-- ------------------------------------------------------------
-- Departamentos (24 filas)
INSERT INTO Departamentos (CodigoDepartamento, Nombre) VALUES
('01', N'Amazonas'),
('02', N'Áncash'),
('03', N'Apurímac'),
('04', N'Arequipa'),
('05', N'Ayacucho'),
('06', N'Cajamarca'),
('07', N'Callao'),
('08', N'Cusco'),
('09', N'Huancavelica'),
('10', N'Huánuco'),
('11', N'Ica'),
('12', N'Junín'),
('13', N'La Libertad'),
('14', N'Lambayeque'),
('15', N'Lima'),
('16', N'Loreto'),
('17', N'Madre de Dios'),
('18', N'Moquegua'),
('19', N'Pasco'),
('20', N'Piura'),
('21', N'Puno'),
('22', N'San Martín'),
('23', N'Tacna'),
('24', N'Tumbes'),
('25', N'Ucayali');
GO

-- Provincias (195 filas)
INSERT INTO Provincias (CodigoProvincia, Nombre, CodigoDepartamento) VALUES
('0101', N'Chachapoyas', '01'),
('0102', N'Bagua', '01'),
('0103', N'Bongará', '01'),
('0104', N'Condorcanqui', '01'),
('0105', N'Luya', '01'),
('0106', N'Rodríguez de Mendoza', '01'),
('0107', N'Utcubamba', '01'),
('0201', N'Huaraz', '02'),
('0202', N'Aija', '02'),
('0203', N'Antonio Raymondi', '02'),
('0204', N'Asunción', '02'),
('0205', N'Bolognesi', '02'),
('0206', N'Carhuaz', '02'),
('0207', N'Carlos Fermín Fitzcarrald', '02'),
('0208', N'Casma', '02'),
('0209', N'Corongo', '02'),
('0210', N'Huari', '02'),
('0211', N'Huarmey', '02'),
('0212', N'Huaylas', '02'),
('0213', N'Mariscal Luzuriaga', '02'),
('0214', N'Ocros', '02'),
('0215', N'Pallasca', '02'),
('0216', N'Pomabamba', '02'),
('0217', N'Recuay', '02'),
('0218', N'Santa', '02'),
('0219', N'Sihuas', '02'),
('0220', N'Yungay', '02'),
('0301', N'Abancay', '03'),
('0302', N'Andahuaylas', '03'),
('0303', N'Antabamba', '03'),
('0304', N'Aymaraes', '03'),
('0305', N'Cotabambas', '03'),
('0306', N'Chincheros', '03'),
('0307', N'Grau', '03'),
('0401', N'Arequipa', '04'),
('0402', N'Camaná', '04'),
('0403', N'Caravelí', '04'),
('0404', N'Castilla', '04'),
('0405', N'Caylloma', '04'),
('0406', N'Condesuyos', '04'),
('0407', N'Islay', '04'),
('0408', N'La Uniòn', '04'),
('0501', N'Huamanga', '05'),
('0502', N'Cangallo', '05'),
('0503', N'Huanca Sancos', '05'),
('0504', N'Huanta', '05'),
('0505', N'La Mar', '05'),
('0506', N'Lucanas', '05'),
('0507', N'Parinacochas', '05'),
('0508', N'Pàucar del Sara Sara', '05'),
('0509', N'Sucre', '05'),
('0510', N'Víctor Fajardo', '05'),
('0511', N'Vilcas Huamán', '05'),
('0601', N'Cajamarca', '06'),
('0602', N'Cajabamba', '06'),
('0603', N'Celendín', '06'),
('0604', N'Chota', '06'),
('0605', N'Contumazá', '06'),
('0606', N'Cutervo', '06'),
('0607', N'Hualgayoc', '06'),
('0608', N'Jaén', '06'),
('0609', N'San Ignacio', '06'),
('0610', N'San Marcos', '06'),
('0611', N'San Miguel', '06'),
('0612', N'San Pablo', '06'),
('0613', N'Santa Cruz', '06'),
('0701', N'Prov. Const. del Callao', '07'),
('0801', N'Cusco', '08'),
('0802', N'Acomayo', '08'),
('0803', N'Anta', '08'),
('0804', N'Calca', '08'),
('0805', N'Canas', '08'),
('0806', N'Canchis', '08'),
('0807', N'Chumbivilcas', '08'),
('0808', N'Espinar', '08'),
('0809', N'La Convención', '08'),
('0810', N'Paruro', '08'),
('0811', N'Paucartambo', '08'),
('0812', N'Quispicanchi', '08'),
('0813', N'Urubamba', '08'),
('0901', N'Huancavelica', '09'),
('0902', N'Acobamba', '09'),
('0903', N'Angaraes', '09'),
('0904', N'Castrovirreyna', '09'),
('0905', N'Churcampa', '09'),
('0906', N'Huaytará', '09'),
('0907', N'Tayacaja', '09'),
('1001', N'Huánuco', '10'),
('1002', N'Ambo', '10'),
('1003', N'Dos de Mayo', '10'),
('1004', N'Huacaybamba', '10'),
('1005', N'Huamalíes', '10'),
('1006', N'Leoncio Prado', '10'),
('1007', N'Marañón', '10'),
('1008', N'Pachitea', '10'),
('1009', N'Puerto Inca', '10'),
('1010', N'Lauricocha ', '10'),
('1011', N'Yarowilca ', '10'),
('1101', N'Ica ', '11'),
('1102', N'Chincha ', '11'),
('1103', N'Nasca ', '11'),
('1104', N'Palpa ', '11'),
('1105', N'Pisco ', '11'),
('1201', N'Huancayo ', '12'),
('1202', N'Concepción ', '12'),
('1203', N'Chanchamayo ', '12'),
('1204', N'Jauja ', '12'),
('1205', N'Junín ', '12'),
('1206', N'Satipo ', '12'),
('1207', N'Tarma ', '12'),
('1208', N'Yauli ', '12'),
('1209', N'Chupaca ', '12'),
('1301', N'Trujillo ', '13'),
('1302', N'Ascope ', '13'),
('1303', N'Bolívar ', '13'),
('1304', N'Chepén ', '13'),
('1305', N'Julcán ', '13'),
('1306', N'Otuzco ', '13'),
('1307', N'Pacasmayo ', '13'),
('1308', N'Pataz ', '13'),
('1309', N'Sánchez Carrión ', '13'),
('1310', N'Santiago de Chuco ', '13'),
('1311', N'Gran Chimú ', '13'),
('1312', N'Virú ', '13'),
('1401', N'Chiclayo ', '14'),
('1402', N'Ferreñafe ', '14'),
('1403', N'Lambayeque ', '14'),
('1501', N'Lima ', '15'),
('1502', N'Barranca ', '15'),
('1503', N'Cajatambo ', '15'),
('1504', N'Canta ', '15'),
('1505', N'Cañete ', '15'),
('1506', N'Huaral ', '15'),
('1507', N'Huarochirí ', '15'),
('1508', N'Huaura ', '15'),
('1509', N'Oyón ', '15'),
('1510', N'Yauyos ', '15'),
('1601', N'Maynas ', '16'),
('1602', N'Alto Amazonas ', '16'),
('1603', N'Loreto ', '16'),
('1604', N'Mariscal Ramón Castilla ', '16'),
('1605', N'Requena ', '16'),
('1606', N'Ucayali ', '16'),
('1607', N'Datem del Marañón ', '16'),
('1608', N'Putumayo', '16'),
('1701', N'Tambopata ', '17'),
('1702', N'Manu ', '17'),
('1703', N'Tahuamanu ', '17'),
('1801', N'Mariscal Nieto ', '18'),
('1802', N'General Sánchez Cerro ', '18'),
('1803', N'Ilo ', '18'),
('1901', N'Pasco ', '19'),
('1902', N'Daniel Alcides Carrión ', '19'),
('1903', N'Oxapampa ', '19'),
('2001', N'Piura ', '20'),
('2002', N'Ayabaca ', '20'),
('2003', N'Huancabamba ', '20'),
('2004', N'Morropón ', '20'),
('2005', N'Paita ', '20'),
('2006', N'Sullana ', '20'),
('2007', N'Talara ', '20'),
('2008', N'Sechura ', '20'),
('2101', N'Puno ', '21'),
('2102', N'Azángaro ', '21'),
('2103', N'Carabaya ', '21'),
('2104', N'Chucuito ', '21'),
('2105', N'El Collao ', '21'),
('2106', N'Huancané ', '21'),
('2107', N'Lampa ', '21'),
('2108', N'Melgar ', '21'),
('2109', N'Moho ', '21'),
('2110', N'San Antonio de Putina ', '21'),
('2111', N'San Román ', '21'),
('2112', N'Sandia ', '21'),
('2113', N'Yunguyo ', '21'),
('2201', N'Moyobamba ', '22'),
('2202', N'Bellavista ', '22'),
('2203', N'El Dorado ', '22'),
('2204', N'Huallaga ', '22'),
('2205', N'Lamas ', '22'),
('2206', N'Mariscal Cáceres ', '22'),
('2207', N'Picota ', '22'),
('2208', N'Rioja ', '22'),
('2209', N'San Martín ', '22'),
('2210', N'Tocache ', '22'),
('2301', N'Tacna ', '23'),
('2302', N'Candarave ', '23'),
('2303', N'Jorge Basadre ', '23'),
('2304', N'Tarata ', '23'),
('2401', N'Tumbes ', '24'),
('2402', N'Contralmirante Villar ', '24'),
('2403', N'Zarumilla ', '24'),
('2501', N'Coronel Portillo ', '25'),
('2502', N'Atalaya ', '25'),
('2503', N'Padre Abad ', '25'),
('2504', N'Purús', '25');
GO

-- Distritos (1873 filas, en lotes de 900 por el límite de SQL Server)
INSERT INTO Distritos (CodigoDistrito, Nombre, CodigoProvincia, CodigoDepartamento) VALUES
('010101', N'Chachapoyas', '0101', '01'),
('010102', N'Asunción', '0101', '01'),
('010103', N'Balsas', '0101', '01'),
('010104', N'Cheto', '0101', '01'),
('010105', N'Chiliquin', '0101', '01'),
('010106', N'Chuquibamba', '0101', '01'),
('010107', N'Granada', '0101', '01'),
('010108', N'Huancas', '0101', '01'),
('010109', N'La Jalca', '0101', '01'),
('010110', N'Leimebamba', '0101', '01'),
('010111', N'Levanto', '0101', '01'),
('010112', N'Magdalena', '0101', '01'),
('010113', N'Mariscal Castilla', '0101', '01'),
('010114', N'Molinopampa', '0101', '01'),
('010115', N'Montevideo', '0101', '01'),
('010116', N'Olleros', '0101', '01'),
('010117', N'Quinjalca', '0101', '01'),
('010118', N'San Francisco de Daguas', '0101', '01'),
('010119', N'San Isidro de Maino', '0101', '01'),
('010120', N'Soloco', '0101', '01'),
('010121', N'Sonche', '0101', '01'),
('010201', N'Bagua', '0102', '01'),
('010202', N'Aramango', '0102', '01'),
('010203', N'Copallin', '0102', '01'),
('010204', N'El Parco', '0102', '01'),
('010205', N'Imaza', '0102', '01'),
('010206', N'La Peca', '0102', '01'),
('010301', N'Jumbilla', '0103', '01'),
('010302', N'Chisquilla', '0103', '01'),
('010303', N'Churuja', '0103', '01'),
('010304', N'Corosha', '0103', '01'),
('010305', N'Cuispes', '0103', '01'),
('010306', N'Florida', '0103', '01'),
('010307', N'Jazan', '0103', '01'),
('010308', N'Recta', '0103', '01'),
('010309', N'San Carlos', '0103', '01'),
('010310', N'Shipasbamba', '0103', '01'),
('010311', N'Valera', '0103', '01'),
('010312', N'Yambrasbamba', '0103', '01'),
('010401', N'Nieva', '0104', '01'),
('010402', N'El Cenepa', '0104', '01'),
('010403', N'Río Santiago', '0104', '01'),
('010501', N'Lamud', '0105', '01'),
('010502', N'Camporredondo', '0105', '01'),
('010503', N'Cocabamba', '0105', '01'),
('010504', N'Colcamar', '0105', '01'),
('010505', N'Conila', '0105', '01'),
('010506', N'Inguilpata', '0105', '01'),
('010507', N'Longuita', '0105', '01'),
('010508', N'Lonya Chico', '0105', '01'),
('010509', N'Luya', '0105', '01'),
('010510', N'Luya Viejo', '0105', '01'),
('010511', N'María', '0105', '01'),
('010512', N'Ocalli', '0105', '01'),
('010513', N'Ocumal', '0105', '01'),
('010514', N'Pisuquia', '0105', '01'),
('010515', N'Providencia', '0105', '01'),
('010516', N'San Cristóbal', '0105', '01'),
('010517', N'San Francisco de Yeso', '0105', '01'),
('010518', N'San Jerónimo', '0105', '01'),
('010519', N'San Juan de Lopecancha', '0105', '01'),
('010520', N'Santa Catalina', '0105', '01'),
('010521', N'Santo Tomas', '0105', '01'),
('010522', N'Tingo', '0105', '01'),
('010523', N'Trita', '0105', '01'),
('010601', N'San Nicolás', '0106', '01'),
('010602', N'Chirimoto', '0106', '01'),
('010603', N'Cochamal', '0106', '01'),
('010604', N'Huambo', '0106', '01'),
('010605', N'Limabamba', '0106', '01'),
('010606', N'Longar', '0106', '01'),
('010607', N'Mariscal Benavides', '0106', '01'),
('010608', N'Milpuc', '0106', '01'),
('010609', N'Omia', '0106', '01'),
('010610', N'Santa Rosa', '0106', '01'),
('010611', N'Totora', '0106', '01'),
('010612', N'Vista Alegre', '0106', '01'),
('010701', N'Bagua Grande', '0107', '01'),
('010702', N'Cajaruro', '0107', '01'),
('010703', N'Cumba', '0107', '01'),
('010704', N'El Milagro', '0107', '01'),
('010705', N'Jamalca', '0107', '01'),
('010706', N'Lonya Grande', '0107', '01'),
('010707', N'Yamon', '0107', '01'),
('020101', N'Huaraz', '0201', '02'),
('020102', N'Cochabamba', '0201', '02'),
('020103', N'Colcabamba', '0201', '02'),
('020104', N'Huanchay', '0201', '02'),
('020105', N'Independencia', '0201', '02'),
('020106', N'Jangas', '0201', '02'),
('020107', N'La Libertad', '0201', '02'),
('020108', N'Olleros', '0201', '02'),
('020109', N'Pampas Grande', '0201', '02'),
('020110', N'Pariacoto', '0201', '02'),
('020111', N'Pira', '0201', '02'),
('020112', N'Tarica', '0201', '02'),
('020201', N'Aija', '0202', '02'),
('020202', N'Coris', '0202', '02'),
('020203', N'Huacllan', '0202', '02'),
('020204', N'La Merced', '0202', '02'),
('020205', N'Succha', '0202', '02'),
('020301', N'Llamellin', '0203', '02'),
('020302', N'Aczo', '0203', '02'),
('020303', N'Chaccho', '0203', '02'),
('020304', N'Chingas', '0203', '02'),
('020305', N'Mirgas', '0203', '02'),
('020306', N'San Juan de Rontoy', '0203', '02'),
('020401', N'Chacas', '0204', '02'),
('020402', N'Acochaca', '0204', '02'),
('020501', N'Chiquian', '0205', '02'),
('020502', N'Abelardo Pardo Lezameta', '0205', '02'),
('020503', N'Antonio Raymondi', '0205', '02'),
('020504', N'Aquia', '0205', '02'),
('020505', N'Cajacay', '0205', '02'),
('020506', N'Canis', '0205', '02'),
('020507', N'Colquioc', '0205', '02'),
('020508', N'Huallanca', '0205', '02'),
('020509', N'Huasta', '0205', '02'),
('020510', N'Huayllacayan', '0205', '02'),
('020511', N'La Primavera', '0205', '02'),
('020512', N'Mangas', '0205', '02'),
('020513', N'Pacllon', '0205', '02'),
('020514', N'San Miguel de Corpanqui', '0205', '02'),
('020515', N'Ticllos', '0205', '02'),
('020601', N'Carhuaz', '0206', '02'),
('020602', N'Acopampa', '0206', '02'),
('020603', N'Amashca', '0206', '02'),
('020604', N'Anta', '0206', '02'),
('020605', N'Ataquero', '0206', '02'),
('020606', N'Marcara', '0206', '02'),
('020607', N'Pariahuanca', '0206', '02'),
('020608', N'San Miguel de Aco', '0206', '02'),
('020609', N'Shilla', '0206', '02'),
('020610', N'Tinco', '0206', '02'),
('020611', N'Yungar', '0206', '02'),
('020701', N'San Luis', '0207', '02'),
('020702', N'San Nicolás', '0207', '02'),
('020703', N'Yauya', '0207', '02'),
('020801', N'Casma', '0208', '02'),
('020802', N'Buena Vista Alta', '0208', '02'),
('020803', N'Comandante Noel', '0208', '02'),
('020804', N'Yautan', '0208', '02'),
('020901', N'Corongo', '0209', '02'),
('020902', N'Aco', '0209', '02'),
('020903', N'Bambas', '0209', '02'),
('020904', N'Cusca', '0209', '02'),
('020905', N'La Pampa', '0209', '02'),
('020906', N'Yanac', '0209', '02'),
('020907', N'Yupan', '0209', '02'),
('021001', N'Huari', '0210', '02'),
('021002', N'Anra', '0210', '02'),
('021003', N'Cajay', '0210', '02'),
('021004', N'Chavin de Huantar', '0210', '02'),
('021005', N'Huacachi', '0210', '02'),
('021006', N'Huacchis', '0210', '02'),
('021007', N'Huachis', '0210', '02'),
('021008', N'Huantar', '0210', '02'),
('021009', N'Masin', '0210', '02'),
('021010', N'Paucas', '0210', '02'),
('021011', N'Ponto', '0210', '02'),
('021012', N'Rahuapampa', '0210', '02'),
('021013', N'Rapayan', '0210', '02'),
('021014', N'San Marcos', '0210', '02'),
('021015', N'San Pedro de Chana', '0210', '02'),
('021016', N'Uco', '0210', '02'),
('021101', N'Huarmey', '0211', '02'),
('021102', N'Cochapeti', '0211', '02'),
('021103', N'Culebras', '0211', '02'),
('021104', N'Huayan', '0211', '02'),
('021105', N'Malvas', '0211', '02'),
('021201', N'Caraz', '0212', '02'),
('021202', N'Huallanca', '0212', '02'),
('021203', N'Huata', '0212', '02'),
('021204', N'Huaylas', '0212', '02'),
('021205', N'Mato', '0212', '02'),
('021206', N'Pamparomas', '0212', '02'),
('021207', N'Pueblo Libre', '0212', '02'),
('021208', N'Santa Cruz', '0212', '02'),
('021209', N'Santo Toribio', '0212', '02'),
('021210', N'Yuracmarca', '0212', '02'),
('021301', N'Piscobamba', '0213', '02'),
('021302', N'Casca', '0213', '02'),
('021303', N'Eleazar Guzmán Barron', '0213', '02'),
('021304', N'Fidel Olivas Escudero', '0213', '02'),
('021305', N'Llama', '0213', '02'),
('021306', N'Llumpa', '0213', '02'),
('021307', N'Lucma', '0213', '02'),
('021308', N'Musga', '0213', '02'),
('021401', N'Ocros', '0214', '02'),
('021402', N'Acas', '0214', '02'),
('021403', N'Cajamarquilla', '0214', '02'),
('021404', N'Carhuapampa', '0214', '02'),
('021405', N'Cochas', '0214', '02'),
('021406', N'Congas', '0214', '02'),
('021407', N'Llipa', '0214', '02'),
('021408', N'San Cristóbal de Rajan', '0214', '02'),
('021409', N'San Pedro', '0214', '02'),
('021410', N'Santiago de Chilcas', '0214', '02'),
('021501', N'Cabana', '0215', '02'),
('021502', N'Bolognesi', '0215', '02'),
('021503', N'Conchucos', '0215', '02'),
('021504', N'Huacaschuque', '0215', '02'),
('021505', N'Huandoval', '0215', '02'),
('021506', N'Lacabamba', '0215', '02'),
('021507', N'Llapo', '0215', '02'),
('021508', N'Pallasca', '0215', '02'),
('021509', N'Pampas', '0215', '02'),
('021510', N'Santa Rosa', '0215', '02'),
('021511', N'Tauca', '0215', '02'),
('021601', N'Pomabamba', '0216', '02'),
('021602', N'Huayllan', '0216', '02'),
('021603', N'Parobamba', '0216', '02'),
('021604', N'Quinuabamba', '0216', '02'),
('021701', N'Recuay', '0217', '02'),
('021702', N'Catac', '0217', '02'),
('021703', N'Cotaparaco', '0217', '02'),
('021704', N'Huayllapampa', '0217', '02'),
('021705', N'Llacllin', '0217', '02'),
('021706', N'Marca', '0217', '02'),
('021707', N'Pampas Chico', '0217', '02'),
('021708', N'Pararin', '0217', '02'),
('021709', N'Tapacocha', '0217', '02'),
('021710', N'Ticapampa', '0217', '02'),
('021801', N'Chimbote', '0218', '02'),
('021802', N'Cáceres del Perú', '0218', '02'),
('021803', N'Coishco', '0218', '02'),
('021804', N'Macate', '0218', '02'),
('021805', N'Moro', '0218', '02'),
('021806', N'Nepeña', '0218', '02'),
('021807', N'Samanco', '0218', '02'),
('021808', N'Santa', '0218', '02'),
('021809', N'Nuevo Chimbote', '0218', '02'),
('021901', N'Sihuas', '0219', '02'),
('021902', N'Acobamba', '0219', '02'),
('021903', N'Alfonso Ugarte', '0219', '02'),
('021904', N'Cashapampa', '0219', '02'),
('021905', N'Chingalpo', '0219', '02'),
('021906', N'Huayllabamba', '0219', '02'),
('021907', N'Quiches', '0219', '02'),
('021908', N'Ragash', '0219', '02'),
('021909', N'San Juan', '0219', '02'),
('021910', N'Sicsibamba', '0219', '02'),
('022001', N'Yungay', '0220', '02'),
('022002', N'Cascapara', '0220', '02'),
('022003', N'Mancos', '0220', '02'),
('022004', N'Matacoto', '0220', '02'),
('022005', N'Quillo', '0220', '02'),
('022006', N'Ranrahirca', '0220', '02'),
('022007', N'Shupluy', '0220', '02'),
('022008', N'Yanama', '0220', '02'),
('030101', N'Abancay', '0301', '03'),
('030102', N'Chacoche', '0301', '03'),
('030103', N'Circa', '0301', '03'),
('030104', N'Curahuasi', '0301', '03'),
('030105', N'Huanipaca', '0301', '03'),
('030106', N'Lambrama', '0301', '03'),
('030107', N'Pichirhua', '0301', '03'),
('030108', N'San Pedro de Cachora', '0301', '03'),
('030109', N'Tamburco', '0301', '03'),
('030201', N'Andahuaylas', '0302', '03'),
('030202', N'Andarapa', '0302', '03'),
('030203', N'Chiara', '0302', '03'),
('030204', N'Huancarama', '0302', '03'),
('030205', N'Huancaray', '0302', '03'),
('030206', N'Huayana', '0302', '03'),
('030207', N'Kishuara', '0302', '03'),
('030208', N'Pacobamba', '0302', '03'),
('030209', N'Pacucha', '0302', '03'),
('030210', N'Pampachiri', '0302', '03'),
('030211', N'Pomacocha', '0302', '03'),
('030212', N'San Antonio de Cachi', '0302', '03'),
('030213', N'San Jerónimo', '0302', '03'),
('030214', N'San Miguel de Chaccrampa', '0302', '03'),
('030215', N'Santa María de Chicmo', '0302', '03'),
('030216', N'Talavera', '0302', '03'),
('030217', N'Tumay Huaraca', '0302', '03'),
('030218', N'Turpo', '0302', '03'),
('030219', N'Kaquiabamba', '0302', '03'),
('030220', N'José María Arguedas', '0302', '03'),
('030301', N'Antabamba', '0303', '03'),
('030302', N'El Oro', '0303', '03'),
('030303', N'Huaquirca', '0303', '03'),
('030304', N'Juan Espinoza Medrano', '0303', '03'),
('030305', N'Oropesa', '0303', '03'),
('030306', N'Pachaconas', '0303', '03'),
('030307', N'Sabaino', '0303', '03'),
('030401', N'Chalhuanca', '0304', '03'),
('030402', N'Capaya', '0304', '03'),
('030403', N'Caraybamba', '0304', '03'),
('030404', N'Chapimarca', '0304', '03'),
('030405', N'Colcabamba', '0304', '03'),
('030406', N'Cotaruse', '0304', '03'),
('030407', N'Ihuayllo', '0304', '03'),
('030408', N'Justo Apu Sahuaraura', '0304', '03'),
('030409', N'Lucre', '0304', '03'),
('030410', N'Pocohuanca', '0304', '03'),
('030411', N'San Juan de Chacña', '0304', '03'),
('030412', N'Sañayca', '0304', '03'),
('030413', N'Soraya', '0304', '03'),
('030414', N'Tapairihua', '0304', '03'),
('030415', N'Tintay', '0304', '03'),
('030416', N'Toraya', '0304', '03'),
('030417', N'Yanaca', '0304', '03'),
('030501', N'Tambobamba', '0305', '03'),
('030502', N'Cotabambas', '0305', '03'),
('030503', N'Coyllurqui', '0305', '03'),
('030504', N'Haquira', '0305', '03'),
('030505', N'Mara', '0305', '03'),
('030506', N'Challhuahuacho', '0305', '03'),
('030601', N'Chincheros', '0306', '03'),
('030602', N'Anco_Huallo', '0306', '03'),
('030603', N'Cocharcas', '0306', '03'),
('030604', N'Huaccana', '0306', '03'),
('030605', N'Ocobamba', '0306', '03'),
('030606', N'Ongoy', '0306', '03'),
('030607', N'Uranmarca', '0306', '03'),
('030608', N'Ranracancha', '0306', '03'),
('030609', N'Rocchacc', '0306', '03'),
('030610', N'El Porvenir', '0306', '03'),
('030611', N'Los Chankas', '0306', '03'),
('030701', N'Chuquibambilla', '0307', '03'),
('030702', N'Curpahuasi', '0307', '03'),
('030703', N'Gamarra', '0307', '03'),
('030704', N'Huayllati', '0307', '03'),
('030705', N'Mamara', '0307', '03'),
('030706', N'Micaela Bastidas', '0307', '03'),
('030707', N'Pataypampa', '0307', '03'),
('030708', N'Progreso', '0307', '03'),
('030709', N'San Antonio', '0307', '03'),
('030710', N'Santa Rosa', '0307', '03'),
('030711', N'Turpay', '0307', '03'),
('030712', N'Vilcabamba', '0307', '03'),
('030713', N'Virundo', '0307', '03'),
('030714', N'Curasco', '0307', '03'),
('040101', N'Arequipa', '0401', '04'),
('040102', N'Alto Selva Alegre', '0401', '04'),
('040103', N'Cayma', '0401', '04'),
('040104', N'Cerro Colorado', '0401', '04'),
('040105', N'Characato', '0401', '04'),
('040106', N'Chiguata', '0401', '04'),
('040107', N'Jacobo Hunter', '0401', '04'),
('040108', N'La Joya', '0401', '04'),
('040109', N'Mariano Melgar', '0401', '04'),
('040110', N'Miraflores', '0401', '04'),
('040111', N'Mollebaya', '0401', '04'),
('040112', N'Paucarpata', '0401', '04'),
('040113', N'Pocsi', '0401', '04'),
('040114', N'Polobaya', '0401', '04'),
('040115', N'Quequeña', '0401', '04'),
('040116', N'Sabandia', '0401', '04'),
('040117', N'Sachaca', '0401', '04'),
('040118', N'San Juan de Siguas', '0401', '04'),
('040119', N'San Juan de Tarucani', '0401', '04'),
('040120', N'Santa Isabel de Siguas', '0401', '04'),
('040121', N'Santa Rita de Siguas', '0401', '04'),
('040122', N'Socabaya', '0401', '04'),
('040123', N'Tiabaya', '0401', '04'),
('040124', N'Uchumayo', '0401', '04'),
('040125', N'Vitor', '0401', '04'),
('040126', N'Yanahuara', '0401', '04'),
('040127', N'Yarabamba', '0401', '04'),
('040128', N'Yura', '0401', '04'),
('040129', N'José Luis Bustamante Y Rivero', '0401', '04'),
('040201', N'Camaná', '0402', '04'),
('040202', N'José María Quimper', '0402', '04'),
('040203', N'Mariano Nicolás Valcárcel', '0402', '04'),
('040204', N'Mariscal Cáceres', '0402', '04'),
('040205', N'Nicolás de Pierola', '0402', '04'),
('040206', N'Ocoña', '0402', '04'),
('040207', N'Quilca', '0402', '04'),
('040208', N'Samuel Pastor', '0402', '04'),
('040301', N'Caravelí', '0403', '04'),
('040302', N'Acarí', '0403', '04'),
('040303', N'Atico', '0403', '04'),
('040304', N'Atiquipa', '0403', '04'),
('040305', N'Bella Unión', '0403', '04'),
('040306', N'Cahuacho', '0403', '04'),
('040307', N'Chala', '0403', '04'),
('040308', N'Chaparra', '0403', '04'),
('040309', N'Huanuhuanu', '0403', '04'),
('040310', N'Jaqui', '0403', '04'),
('040311', N'Lomas', '0403', '04'),
('040312', N'Quicacha', '0403', '04'),
('040313', N'Yauca', '0403', '04'),
('040401', N'Aplao', '0404', '04'),
('040402', N'Andagua', '0404', '04'),
('040403', N'Ayo', '0404', '04'),
('040404', N'Chachas', '0404', '04'),
('040405', N'Chilcaymarca', '0404', '04'),
('040406', N'Choco', '0404', '04'),
('040407', N'Huancarqui', '0404', '04'),
('040408', N'Machaguay', '0404', '04'),
('040409', N'Orcopampa', '0404', '04'),
('040410', N'Pampacolca', '0404', '04'),
('040411', N'Tipan', '0404', '04'),
('040412', N'Uñon', '0404', '04'),
('040413', N'Uraca', '0404', '04'),
('040414', N'Viraco', '0404', '04'),
('040501', N'Chivay', '0405', '04'),
('040502', N'Achoma', '0405', '04'),
('040503', N'Cabanaconde', '0405', '04'),
('040504', N'Callalli', '0405', '04'),
('040505', N'Caylloma', '0405', '04'),
('040506', N'Coporaque', '0405', '04'),
('040507', N'Huambo', '0405', '04'),
('040508', N'Huanca', '0405', '04'),
('040509', N'Ichupampa', '0405', '04'),
('040510', N'Lari', '0405', '04'),
('040511', N'Lluta', '0405', '04'),
('040512', N'Maca', '0405', '04'),
('040513', N'Madrigal', '0405', '04'),
('040514', N'San Antonio de Chuca', '0405', '04'),
('040515', N'Sibayo', '0405', '04'),
('040516', N'Tapay', '0405', '04'),
('040517', N'Tisco', '0405', '04'),
('040518', N'Tuti', '0405', '04'),
('040519', N'Yanque', '0405', '04'),
('040520', N'Majes', '0405', '04'),
('040601', N'Chuquibamba', '0406', '04'),
('040602', N'Andaray', '0406', '04'),
('040603', N'Cayarani', '0406', '04'),
('040604', N'Chichas', '0406', '04'),
('040605', N'Iray', '0406', '04'),
('040606', N'Río Grande', '0406', '04'),
('040607', N'Salamanca', '0406', '04'),
('040608', N'Yanaquihua', '0406', '04'),
('040701', N'Mollendo', '0407', '04'),
('040702', N'Cocachacra', '0407', '04'),
('040703', N'Dean Valdivia', '0407', '04'),
('040704', N'Islay', '0407', '04'),
('040705', N'Mejia', '0407', '04'),
('040706', N'Punta de Bombón', '0407', '04'),
('040801', N'Cotahuasi', '0408', '04'),
('040802', N'Alca', '0408', '04'),
('040803', N'Charcana', '0408', '04'),
('040804', N'Huaynacotas', '0408', '04'),
('040805', N'Pampamarca', '0408', '04'),
('040806', N'Puyca', '0408', '04'),
('040807', N'Quechualla', '0408', '04'),
('040808', N'Sayla', '0408', '04'),
('040809', N'Tauria', '0408', '04'),
('040810', N'Tomepampa', '0408', '04'),
('040811', N'Toro', '0408', '04'),
('050101', N'Ayacucho', '0501', '05'),
('050102', N'Acocro', '0501', '05'),
('050103', N'Acos Vinchos', '0501', '05'),
('050104', N'Carmen Alto', '0501', '05'),
('050105', N'Chiara', '0501', '05'),
('050106', N'Ocros', '0501', '05'),
('050107', N'Pacaycasa', '0501', '05'),
('050108', N'Quinua', '0501', '05'),
('050109', N'San José de Ticllas', '0501', '05'),
('050110', N'San Juan Bautista', '0501', '05'),
('050111', N'Santiago de Pischa', '0501', '05'),
('050112', N'Socos', '0501', '05'),
('050113', N'Tambillo', '0501', '05'),
('050114', N'Vinchos', '0501', '05'),
('050115', N'Jesús Nazareno', '0501', '05'),
('050116', N'Andrés Avelino Cáceres Dorregaray', '0501', '05'),
('050201', N'Cangallo', '0502', '05'),
('050202', N'Chuschi', '0502', '05'),
('050203', N'Los Morochucos', '0502', '05'),
('050204', N'María Parado de Bellido', '0502', '05'),
('050205', N'Paras', '0502', '05'),
('050206', N'Totos', '0502', '05'),
('050301', N'Sancos', '0503', '05'),
('050302', N'Carapo', '0503', '05'),
('050303', N'Sacsamarca', '0503', '05'),
('050304', N'Santiago de Lucanamarca', '0503', '05'),
('050401', N'Huanta', '0504', '05'),
('050402', N'Ayahuanco', '0504', '05'),
('050403', N'Huamanguilla', '0504', '05'),
('050404', N'Iguain', '0504', '05'),
('050405', N'Luricocha', '0504', '05'),
('050406', N'Santillana', '0504', '05'),
('050407', N'Sivia', '0504', '05'),
('050408', N'Llochegua', '0504', '05'),
('050409', N'Canayre', '0504', '05'),
('050410', N'Uchuraccay', '0504', '05'),
('050411', N'Pucacolpa', '0504', '05'),
('050412', N'Chaca', '0504', '05'),
('050501', N'San Miguel', '0505', '05'),
('050502', N'Anco', '0505', '05'),
('050503', N'Ayna', '0505', '05'),
('050504', N'Chilcas', '0505', '05'),
('050505', N'Chungui', '0505', '05'),
('050506', N'Luis Carranza', '0505', '05'),
('050507', N'Santa Rosa', '0505', '05'),
('050508', N'Tambo', '0505', '05'),
('050509', N'Samugari', '0505', '05'),
('050510', N'Anchihuay', '0505', '05'),
('050511', N'Oronccoy', '0505', '05'),
('050601', N'Puquio', '0506', '05'),
('050602', N'Aucara', '0506', '05'),
('050603', N'Cabana', '0506', '05'),
('050604', N'Carmen Salcedo', '0506', '05'),
('050605', N'Chaviña', '0506', '05'),
('050606', N'Chipao', '0506', '05'),
('050607', N'Huac-Huas', '0506', '05'),
('050608', N'Laramate', '0506', '05'),
('050609', N'Leoncio Prado', '0506', '05'),
('050610', N'Llauta', '0506', '05'),
('050611', N'Lucanas', '0506', '05'),
('050612', N'Ocaña', '0506', '05'),
('050613', N'Otoca', '0506', '05'),
('050614', N'Saisa', '0506', '05'),
('050615', N'San Cristóbal', '0506', '05'),
('050616', N'San Juan', '0506', '05'),
('050617', N'San Pedro', '0506', '05'),
('050618', N'San Pedro de Palco', '0506', '05'),
('050619', N'Sancos', '0506', '05'),
('050620', N'Santa Ana de Huaycahuacho', '0506', '05'),
('050621', N'Santa Lucia', '0506', '05'),
('050701', N'Coracora', '0507', '05'),
('050702', N'Chumpi', '0507', '05'),
('050703', N'Coronel Castañeda', '0507', '05'),
('050704', N'Pacapausa', '0507', '05'),
('050705', N'Pullo', '0507', '05'),
('050706', N'Puyusca', '0507', '05'),
('050707', N'San Francisco de Ravacayco', '0507', '05'),
('050708', N'Upahuacho', '0507', '05'),
('050801', N'Pausa', '0508', '05'),
('050802', N'Colta', '0508', '05'),
('050803', N'Corculla', '0508', '05'),
('050804', N'Lampa', '0508', '05'),
('050805', N'Marcabamba', '0508', '05'),
('050806', N'Oyolo', '0508', '05'),
('050807', N'Pararca', '0508', '05'),
('050808', N'San Javier de Alpabamba', '0508', '05'),
('050809', N'San José de Ushua', '0508', '05'),
('050810', N'Sara Sara', '0508', '05'),
('050901', N'Querobamba', '0509', '05'),
('050902', N'Belén', '0509', '05'),
('050903', N'Chalcos', '0509', '05'),
('050904', N'Chilcayoc', '0509', '05'),
('050905', N'Huacaña', '0509', '05'),
('050906', N'Morcolla', '0509', '05'),
('050907', N'Paico', '0509', '05'),
('050908', N'San Pedro de Larcay', '0509', '05'),
('050909', N'San Salvador de Quije', '0509', '05'),
('050910', N'Santiago de Paucaray', '0509', '05'),
('050911', N'Soras', '0509', '05'),
('051001', N'Huancapi', '0510', '05'),
('051002', N'Alcamenca', '0510', '05'),
('051003', N'Apongo', '0510', '05'),
('051004', N'Asquipata', '0510', '05'),
('051005', N'Canaria', '0510', '05'),
('051006', N'Cayara', '0510', '05'),
('051007', N'Colca', '0510', '05'),
('051008', N'Huamanquiquia', '0510', '05'),
('051009', N'Huancaraylla', '0510', '05'),
('051010', N'Hualla', '0510', '05'),
('051011', N'Sarhua', '0510', '05'),
('051012', N'Vilcanchos', '0510', '05'),
('051101', N'Vilcas Huaman', '0511', '05'),
('051102', N'Accomarca', '0511', '05'),
('051103', N'Carhuanca', '0511', '05'),
('051104', N'Concepción', '0511', '05'),
('051105', N'Huambalpa', '0511', '05'),
('051106', N'Independencia', '0511', '05'),
('051107', N'Saurama', '0511', '05'),
('051108', N'Vischongo', '0511', '05'),
('060101', N'Cajamarca', '0601', '06'),
('060102', N'Asunción', '0601', '06'),
('060103', N'Chetilla', '0601', '06'),
('060104', N'Cospan', '0601', '06'),
('060105', N'Encañada', '0601', '06'),
('060106', N'Jesús', '0601', '06'),
('060107', N'Llacanora', '0601', '06'),
('060108', N'Los Baños del Inca', '0601', '06'),
('060109', N'Magdalena', '0601', '06'),
('060110', N'Matara', '0601', '06'),
('060111', N'Namora', '0601', '06'),
('060112', N'San Juan', '0601', '06'),
('060201', N'Cajabamba', '0602', '06'),
('060202', N'Cachachi', '0602', '06'),
('060203', N'Condebamba', '0602', '06'),
('060204', N'Sitacocha', '0602', '06'),
('060301', N'Celendín', '0603', '06'),
('060302', N'Chumuch', '0603', '06'),
('060303', N'Cortegana', '0603', '06'),
('060304', N'Huasmin', '0603', '06'),
('060305', N'Jorge Chávez', '0603', '06'),
('060306', N'José Gálvez', '0603', '06'),
('060307', N'Miguel Iglesias', '0603', '06'),
('060308', N'Oxamarca', '0603', '06'),
('060309', N'Sorochuco', '0603', '06'),
('060310', N'Sucre', '0603', '06'),
('060311', N'Utco', '0603', '06'),
('060312', N'La Libertad de Pallan', '0603', '06'),
('060401', N'Chota', '0604', '06'),
('060402', N'Anguia', '0604', '06'),
('060403', N'Chadin', '0604', '06'),
('060404', N'Chiguirip', '0604', '06'),
('060405', N'Chimban', '0604', '06'),
('060406', N'Choropampa', '0604', '06'),
('060407', N'Cochabamba', '0604', '06'),
('060408', N'Conchan', '0604', '06'),
('060409', N'Huambos', '0604', '06'),
('060410', N'Lajas', '0604', '06'),
('060411', N'Llama', '0604', '06'),
('060412', N'Miracosta', '0604', '06'),
('060413', N'Paccha', '0604', '06'),
('060414', N'Pion', '0604', '06'),
('060415', N'Querocoto', '0604', '06'),
('060416', N'San Juan de Licupis', '0604', '06'),
('060417', N'Tacabamba', '0604', '06'),
('060418', N'Tocmoche', '0604', '06'),
('060419', N'Chalamarca', '0604', '06'),
('060501', N'Contumaza', '0605', '06'),
('060502', N'Chilete', '0605', '06'),
('060503', N'Cupisnique', '0605', '06'),
('060504', N'Guzmango', '0605', '06'),
('060505', N'San Benito', '0605', '06'),
('060506', N'Santa Cruz de Toledo', '0605', '06'),
('060507', N'Tantarica', '0605', '06'),
('060508', N'Yonan', '0605', '06'),
('060601', N'Cutervo', '0606', '06'),
('060602', N'Callayuc', '0606', '06'),
('060603', N'Choros', '0606', '06'),
('060604', N'Cujillo', '0606', '06'),
('060605', N'La Ramada', '0606', '06'),
('060606', N'Pimpingos', '0606', '06'),
('060607', N'Querocotillo', '0606', '06'),
('060608', N'San Andrés de Cutervo', '0606', '06'),
('060609', N'San Juan de Cutervo', '0606', '06'),
('060610', N'San Luis de Lucma', '0606', '06'),
('060611', N'Santa Cruz', '0606', '06'),
('060612', N'Santo Domingo de la Capilla', '0606', '06'),
('060613', N'Santo Tomas', '0606', '06'),
('060614', N'Socota', '0606', '06'),
('060615', N'Toribio Casanova', '0606', '06'),
('060701', N'Bambamarca', '0607', '06'),
('060702', N'Chugur', '0607', '06'),
('060703', N'Hualgayoc', '0607', '06'),
('060801', N'Jaén', '0608', '06'),
('060802', N'Bellavista', '0608', '06'),
('060803', N'Chontali', '0608', '06'),
('060804', N'Colasay', '0608', '06'),
('060805', N'Huabal', '0608', '06'),
('060806', N'Las Pirias', '0608', '06'),
('060807', N'Pomahuaca', '0608', '06'),
('060808', N'Pucara', '0608', '06'),
('060809', N'Sallique', '0608', '06'),
('060810', N'San Felipe', '0608', '06'),
('060811', N'San José del Alto', '0608', '06'),
('060812', N'Santa Rosa', '0608', '06'),
('060901', N'San Ignacio', '0609', '06'),
('060902', N'Chirinos', '0609', '06'),
('060903', N'Huarango', '0609', '06'),
('060904', N'La Coipa', '0609', '06'),
('060905', N'Namballe', '0609', '06'),
('060906', N'San José de Lourdes', '0609', '06'),
('060907', N'Tabaconas', '0609', '06'),
('061001', N'Pedro Gálvez', '0610', '06'),
('061002', N'Chancay', '0610', '06'),
('061003', N'Eduardo Villanueva', '0610', '06'),
('061004', N'Gregorio Pita', '0610', '06'),
('061005', N'Ichocan', '0610', '06'),
('061006', N'José Manuel Quiroz', '0610', '06'),
('061007', N'José Sabogal', '0610', '06'),
('061101', N'San Miguel', '0611', '06'),
('061102', N'Bolívar', '0611', '06'),
('061103', N'Calquis', '0611', '06'),
('061104', N'Catilluc', '0611', '06'),
('061105', N'El Prado', '0611', '06'),
('061106', N'La Florida', '0611', '06'),
('061107', N'Llapa', '0611', '06'),
('061108', N'Nanchoc', '0611', '06'),
('061109', N'Niepos', '0611', '06'),
('061110', N'San Gregorio', '0611', '06'),
('061111', N'San Silvestre de Cochan', '0611', '06'),
('061112', N'Tongod', '0611', '06'),
('061113', N'Unión Agua Blanca', '0611', '06'),
('061201', N'San Pablo', '0612', '06'),
('061202', N'San Bernardino', '0612', '06'),
('061203', N'San Luis', '0612', '06'),
('061204', N'Tumbaden', '0612', '06'),
('061301', N'Santa Cruz', '0613', '06'),
('061302', N'Andabamba', '0613', '06'),
('061303', N'Catache', '0613', '06'),
('061304', N'Chancaybaños', '0613', '06'),
('061305', N'La Esperanza', '0613', '06'),
('061306', N'Ninabamba', '0613', '06'),
('061307', N'Pulan', '0613', '06'),
('061308', N'Saucepampa', '0613', '06'),
('061309', N'Sexi', '0613', '06'),
('061310', N'Uticyacu', '0613', '06'),
('061311', N'Yauyucan', '0613', '06'),
('070101', N'Callao', '0701', '07'),
('070102', N'Bellavista', '0701', '07'),
('070103', N'Carmen de la Legua Reynoso', '0701', '07'),
('070104', N'La Perla', '0701', '07'),
('070105', N'La Punta', '0701', '07'),
('070106', N'Ventanilla', '0701', '07'),
('070107', N'Mi Perú', '0701', '07'),
('080101', N'Cusco', '0801', '08'),
('080102', N'Ccorca', '0801', '08'),
('080103', N'Poroy', '0801', '08'),
('080104', N'San Jerónimo', '0801', '08'),
('080105', N'San Sebastian', '0801', '08'),
('080106', N'Santiago', '0801', '08'),
('080107', N'Saylla', '0801', '08'),
('080108', N'Wanchaq', '0801', '08'),
('080201', N'Acomayo', '0802', '08'),
('080202', N'Acopia', '0802', '08'),
('080203', N'Acos', '0802', '08'),
('080204', N'Mosoc Llacta', '0802', '08'),
('080205', N'Pomacanchi', '0802', '08'),
('080206', N'Rondocan', '0802', '08'),
('080207', N'Sangarara', '0802', '08'),
('080301', N'Anta', '0803', '08'),
('080302', N'Ancahuasi', '0803', '08'),
('080303', N'Cachimayo', '0803', '08'),
('080304', N'Chinchaypujio', '0803', '08'),
('080305', N'Huarocondo', '0803', '08'),
('080306', N'Limatambo', '0803', '08'),
('080307', N'Mollepata', '0803', '08'),
('080308', N'Pucyura', '0803', '08'),
('080309', N'Zurite', '0803', '08'),
('080401', N'Calca', '0804', '08'),
('080402', N'Coya', '0804', '08'),
('080403', N'Lamay', '0804', '08'),
('080404', N'Lares', '0804', '08'),
('080405', N'Pisac', '0804', '08'),
('080406', N'San Salvador', '0804', '08'),
('080407', N'Taray', '0804', '08'),
('080408', N'Yanatile', '0804', '08'),
('080501', N'Yanaoca', '0805', '08'),
('080502', N'Checca', '0805', '08'),
('080503', N'Kunturkanki', '0805', '08'),
('080504', N'Langui', '0805', '08'),
('080505', N'Layo', '0805', '08'),
('080506', N'Pampamarca', '0805', '08'),
('080507', N'Quehue', '0805', '08'),
('080508', N'Tupac Amaru', '0805', '08'),
('080601', N'Sicuani', '0806', '08'),
('080602', N'Checacupe', '0806', '08'),
('080603', N'Combapata', '0806', '08'),
('080604', N'Marangani', '0806', '08'),
('080605', N'Pitumarca', '0806', '08'),
('080606', N'San Pablo', '0806', '08'),
('080607', N'San Pedro', '0806', '08'),
('080608', N'Tinta', '0806', '08'),
('080701', N'Santo Tomas', '0807', '08'),
('080702', N'Capacmarca', '0807', '08'),
('080703', N'Chamaca', '0807', '08'),
('080704', N'Colquemarca', '0807', '08'),
('080705', N'Livitaca', '0807', '08'),
('080706', N'Llusco', '0807', '08'),
('080707', N'Quiñota', '0807', '08'),
('080708', N'Velille', '0807', '08'),
('080801', N'Espinar', '0808', '08'),
('080802', N'Condoroma', '0808', '08'),
('080803', N'Coporaque', '0808', '08'),
('080804', N'Ocoruro', '0808', '08'),
('080805', N'Pallpata', '0808', '08'),
('080806', N'Pichigua', '0808', '08'),
('080807', N'Suyckutambo', '0808', '08'),
('080808', N'Alto Pichigua', '0808', '08'),
('080901', N'Santa Ana', '0809', '08'),
('080902', N'Echarate', '0809', '08'),
('080903', N'Huayopata', '0809', '08'),
('080904', N'Maranura', '0809', '08'),
('080905', N'Ocobamba', '0809', '08'),
('080906', N'Quellouno', '0809', '08'),
('080907', N'Kimbiri', '0809', '08'),
('080908', N'Santa Teresa', '0809', '08'),
('080909', N'Vilcabamba', '0809', '08'),
('080910', N'Pichari', '0809', '08'),
('080911', N'Inkawasi', '0809', '08'),
('080912', N'Villa Virgen', '0809', '08'),
('080913', N'Villa Kintiarina', '0809', '08'),
('080914', N'Megantoni', '0809', '08'),
('081001', N'Paruro', '0810', '08'),
('081002', N'Accha', '0810', '08'),
('081003', N'Ccapi', '0810', '08'),
('081004', N'Colcha', '0810', '08'),
('081005', N'Huanoquite', '0810', '08'),
('081006', N'Omachaç', '0810', '08'),
('081007', N'Paccaritambo', '0810', '08'),
('081008', N'Pillpinto', '0810', '08'),
('081009', N'Yaurisque', '0810', '08'),
('081101', N'Paucartambo', '0811', '08'),
('081102', N'Caicay', '0811', '08'),
('081103', N'Challabamba', '0811', '08'),
('081104', N'Colquepata', '0811', '08'),
('081105', N'Huancarani', '0811', '08'),
('081106', N'Kosñipata', '0811', '08'),
('081201', N'Urcos', '0812', '08'),
('081202', N'Andahuaylillas', '0812', '08'),
('081203', N'Camanti', '0812', '08'),
('081204', N'Ccarhuayo', '0812', '08'),
('081205', N'Ccatca', '0812', '08'),
('081206', N'Cusipata', '0812', '08'),
('081207', N'Huaro', '0812', '08'),
('081208', N'Lucre', '0812', '08'),
('081209', N'Marcapata', '0812', '08'),
('081210', N'Ocongate', '0812', '08'),
('081211', N'Oropesa', '0812', '08'),
('081212', N'Quiquijana', '0812', '08'),
('081301', N'Urubamba', '0813', '08'),
('081302', N'Chinchero', '0813', '08'),
('081303', N'Huayllabamba', '0813', '08'),
('081304', N'Machupicchu', '0813', '08'),
('081305', N'Maras', '0813', '08'),
('081306', N'Ollantaytambo', '0813', '08'),
('081307', N'Yucay', '0813', '08'),
('090101', N'Huancavelica', '0901', '09'),
('090102', N'Acobambilla', '0901', '09'),
('090103', N'Acoria', '0901', '09'),
('090104', N'Conayca', '0901', '09'),
('090105', N'Cuenca', '0901', '09'),
('090106', N'Huachocolpa', '0901', '09'),
('090107', N'Huayllahuara', '0901', '09'),
('090108', N'Izcuchaca', '0901', '09'),
('090109', N'Laria', '0901', '09'),
('090110', N'Manta', '0901', '09'),
('090111', N'Mariscal Cáceres', '0901', '09'),
('090112', N'Moya', '0901', '09'),
('090113', N'Nuevo Occoro', '0901', '09'),
('090114', N'Palca', '0901', '09'),
('090115', N'Pilchaca', '0901', '09'),
('090116', N'Vilca', '0901', '09'),
('090117', N'Yauli', '0901', '09'),
('090118', N'Ascensión', '0901', '09'),
('090119', N'Huando', '0901', '09'),
('090201', N'Acobamba', '0902', '09'),
('090202', N'Andabamba', '0902', '09'),
('090203', N'Anta', '0902', '09'),
('090204', N'Caja', '0902', '09'),
('090205', N'Marcas', '0902', '09'),
('090206', N'Paucara', '0902', '09'),
('090207', N'Pomacocha', '0902', '09'),
('090208', N'Rosario', '0902', '09'),
('090301', N'Lircay', '0903', '09'),
('090302', N'Anchonga', '0903', '09'),
('090303', N'Callanmarca', '0903', '09'),
('090304', N'Ccochaccasa', '0903', '09'),
('090305', N'Chincho', '0903', '09'),
('090306', N'Congalla', '0903', '09'),
('090307', N'Huanca-Huanca', '0903', '09'),
('090308', N'Huayllay Grande', '0903', '09'),
('090309', N'Julcamarca', '0903', '09'),
('090310', N'San Antonio de Antaparco', '0903', '09'),
('090311', N'Santo Tomas de Pata', '0903', '09'),
('090312', N'Secclla', '0903', '09'),
('090401', N'Castrovirreyna', '0904', '09'),
('090402', N'Arma', '0904', '09'),
('090403', N'Aurahua', '0904', '09'),
('090404', N'Capillas', '0904', '09'),
('090405', N'Chupamarca', '0904', '09'),
('090406', N'Cocas', '0904', '09'),
('090407', N'Huachos', '0904', '09'),
('090408', N'Huamatambo', '0904', '09'),
('090409', N'Mollepampa', '0904', '09'),
('090410', N'San Juan', '0904', '09'),
('090411', N'Santa Ana', '0904', '09'),
('090412', N'Tantara', '0904', '09'),
('090413', N'Ticrapo', '0904', '09'),
('090501', N'Churcampa', '0905', '09'),
('090502', N'Anco', '0905', '09'),
('090503', N'Chinchihuasi', '0905', '09'),
('090504', N'El Carmen', '0905', '09'),
('090505', N'La Merced', '0905', '09'),
('090506', N'Locroja', '0905', '09'),
('090507', N'Paucarbamba', '0905', '09'),
('090508', N'San Miguel de Mayocc', '0905', '09'),
('090509', N'San Pedro de Coris', '0905', '09'),
('090510', N'Pachamarca', '0905', '09'),
('090511', N'Cosme', '0905', '09'),
('090601', N'Huaytara', '0906', '09'),
('090602', N'Ayavi', '0906', '09'),
('090603', N'Córdova', '0906', '09'),
('090604', N'Huayacundo Arma', '0906', '09'),
('090605', N'Laramarca', '0906', '09'),
('090606', N'Ocoyo', '0906', '09'),
('090607', N'Pilpichaca', '0906', '09'),
('090608', N'Querco', '0906', '09'),
('090609', N'Quito-Arma', '0906', '09'),
('090610', N'San Antonio de Cusicancha', '0906', '09'),
('090611', N'San Francisco de Sangayaico', '0906', '09'),
('090612', N'San Isidro', '0906', '09'),
('090613', N'Santiago de Chocorvos', '0906', '09'),
('090614', N'Santiago de Quirahuara', '0906', '09'),
('090615', N'Santo Domingo de Capillas', '0906', '09'),
('090616', N'Tambo', '0906', '09'),
('090701', N'Pampas', '0907', '09'),
('090702', N'Acostambo', '0907', '09'),
('090703', N'Acraquia', '0907', '09'),
('090704', N'Ahuaycha', '0907', '09'),
('090705', N'Colcabamba', '0907', '09'),
('090706', N'Daniel Hernández', '0907', '09'),
('090707', N'Huachocolpa', '0907', '09'),
('090709', N'Huaribamba', '0907', '09'),
('090710', N'Ñahuimpuquio', '0907', '09'),
('090711', N'Pazos', '0907', '09'),
('090713', N'Quishuar', '0907', '09'),
('090714', N'Salcabamba', '0907', '09'),
('090715', N'Salcahuasi', '0907', '09');
GO

INSERT INTO Distritos (CodigoDistrito, Nombre, CodigoProvincia, CodigoDepartamento) VALUES
('090716', N'San Marcos de Rocchac', '0907', '09'),
('090717', N'Surcubamba', '0907', '09'),
('090718', N'Tintay Puncu', '0907', '09'),
('090719', N'Quichuas', '0907', '09'),
('090720', N'Andaymarca', '0907', '09'),
('090721', N'Roble', '0907', '09'),
('090722', N'Pichos', '0907', '09'),
('090723', N'Santiago de Tucuma', '0907', '09'),
('100101', N'Huanuco', '1001', '10'),
('100102', N'Amarilis', '1001', '10'),
('100103', N'Chinchao', '1001', '10'),
('100104', N'Churubamba', '1001', '10'),
('100105', N'Margos', '1001', '10'),
('100106', N'Quisqui (Kichki)', '1001', '10'),
('100107', N'San Francisco de Cayran', '1001', '10'),
('100108', N'San Pedro de Chaulan', '1001', '10'),
('100109', N'Santa María del Valle', '1001', '10'),
('100110', N'Yarumayo', '1001', '10'),
('100111', N'Pillco Marca', '1001', '10'),
('100112', N'Yacus', '1001', '10'),
('100113', N'San Pablo de Pillao', '1001', '10'),
('100201', N'Ambo', '1002', '10'),
('100202', N'Cayna', '1002', '10'),
('100203', N'Colpas', '1002', '10'),
('100204', N'Conchamarca', '1002', '10'),
('100205', N'Huacar', '1002', '10'),
('100206', N'San Francisco', '1002', '10'),
('100207', N'San Rafael', '1002', '10'),
('100208', N'Tomay Kichwa', '1002', '10'),
('100301', N'La Unión', '1003', '10'),
('100307', N'Chuquis', '1003', '10'),
('100311', N'Marías', '1003', '10'),
('100313', N'Pachas', '1003', '10'),
('100316', N'Quivilla', '1003', '10'),
('100317', N'Ripan', '1003', '10'),
('100321', N'Shunqui', '1003', '10'),
('100322', N'Sillapata', '1003', '10'),
('100323', N'Yanas', '1003', '10'),
('100401', N'Huacaybamba', '1004', '10'),
('100402', N'Canchabamba', '1004', '10'),
('100403', N'Cochabamba', '1004', '10'),
('100404', N'Pinra', '1004', '10'),
('100501', N'Llata', '1005', '10'),
('100502', N'Arancay', '1005', '10'),
('100503', N'Chavín de Pariarca', '1005', '10'),
('100504', N'Jacas Grande', '1005', '10'),
('100505', N'Jircan', '1005', '10'),
('100506', N'Miraflores', '1005', '10'),
('100507', N'Monzón', '1005', '10'),
('100508', N'Punchao', '1005', '10'),
('100509', N'Puños', '1005', '10'),
('100510', N'Singa', '1005', '10'),
('100511', N'Tantamayo', '1005', '10'),
('100601', N'Rupa-Rupa', '1006', '10'),
('100602', N'Daniel Alomía Robles', '1006', '10'),
('100603', N'Hermílio Valdizan', '1006', '10'),
('100604', N'José Crespo y Castillo', '1006', '10'),
('100605', N'Luyando', '1006', '10'),
('100606', N'Mariano Damaso Beraun', '1006', '10'),
('100607', N'Pucayacu', '1006', '10'),
('100608', N'Castillo Grande', '1006', '10'),
('100609', N'Pueblo Nuevo', '1006', '10'),
('100610', N'Santo Domingo de Anda', '1006', '10'),
('100701', N'Huacrachuco', '1007', '10'),
('100702', N'Cholon', '1007', '10'),
('100703', N'San Buenaventura', '1007', '10'),
('100704', N'La Morada', '1007', '10'),
('100705', N'Santa Rosa de Alto Yanajanca', '1007', '10'),
('100801', N'Panao', '1008', '10'),
('100802', N'Chaglla', '1008', '10'),
('100803', N'Molino', '1008', '10'),
('100804', N'Umari', '1008', '10'),
('100901', N'Puerto Inca', '1009', '10'),
('100902', N'Codo del Pozuzo', '1009', '10'),
('100903', N'Honoria', '1009', '10'),
('100904', N'Tournavista', '1009', '10'),
('100905', N'Yuyapichis', '1009', '10'),
('101001', N'Jesús', '1010', '10'),
('101002', N'Baños', '1010', '10'),
('101003', N'Jivia', '1010', '10'),
('101004', N'Queropalca', '1010', '10'),
('101005', N'Rondos', '1010', '10'),
('101006', N'San Francisco de Asís', '1010', '10'),
('101007', N'San Miguel de Cauri', '1010', '10'),
('101101', N'Chavinillo', '1011', '10'),
('101102', N'Cahuac', '1011', '10'),
('101103', N'Chacabamba', '1011', '10'),
('101104', N'Aparicio Pomares', '1011', '10'),
('101105', N'Jacas Chico', '1011', '10'),
('101106', N'Obas', '1011', '10'),
('101107', N'Pampamarca', '1011', '10'),
('101108', N'Choras', '1011', '10'),
('110101', N'Ica', '1101', '11'),
('110102', N'La Tinguiña', '1101', '11'),
('110103', N'Los Aquijes', '1101', '11'),
('110104', N'Ocucaje', '1101', '11'),
('110105', N'Pachacutec', '1101', '11'),
('110106', N'Parcona', '1101', '11'),
('110107', N'Pueblo Nuevo', '1101', '11'),
('110108', N'Salas', '1101', '11'),
('110109', N'San José de Los Molinos', '1101', '11'),
('110110', N'San Juan Bautista', '1101', '11'),
('110111', N'Santiago', '1101', '11'),
('110112', N'Subtanjalla', '1101', '11'),
('110113', N'Tate', '1101', '11'),
('110114', N'Yauca del Rosario', '1101', '11'),
('110201', N'Chincha Alta', '1102', '11'),
('110202', N'Alto Laran', '1102', '11'),
('110203', N'Chavin', '1102', '11'),
('110204', N'Chincha Baja', '1102', '11'),
('110205', N'El Carmen', '1102', '11'),
('110206', N'Grocio Prado', '1102', '11'),
('110207', N'Pueblo Nuevo', '1102', '11'),
('110208', N'San Juan de Yanac', '1102', '11'),
('110209', N'San Pedro de Huacarpana', '1102', '11'),
('110210', N'Sunampe', '1102', '11'),
('110211', N'Tambo de Mora', '1102', '11'),
('110301', N'Nasca', '1103', '11'),
('110302', N'Changuillo', '1103', '11'),
('110303', N'El Ingenio', '1103', '11'),
('110304', N'Marcona', '1103', '11'),
('110305', N'Vista Alegre', '1103', '11'),
('110401', N'Palpa', '1104', '11'),
('110402', N'Llipata', '1104', '11'),
('110403', N'Río Grande', '1104', '11'),
('110404', N'Santa Cruz', '1104', '11'),
('110405', N'Tibillo', '1104', '11'),
('110501', N'Pisco', '1105', '11'),
('110502', N'Huancano', '1105', '11'),
('110503', N'Humay', '1105', '11'),
('110504', N'Independencia', '1105', '11'),
('110505', N'Paracas', '1105', '11'),
('110506', N'San Andrés', '1105', '11'),
('110507', N'San Clemente', '1105', '11'),
('110508', N'Tupac Amaru Inca', '1105', '11'),
('120101', N'Huancayo', '1201', '12'),
('120104', N'Carhuacallanga', '1201', '12'),
('120105', N'Chacapampa', '1201', '12'),
('120106', N'Chicche', '1201', '12'),
('120107', N'Chilca', '1201', '12'),
('120108', N'Chongos Alto', '1201', '12'),
('120111', N'Chupuro', '1201', '12'),
('120112', N'Colca', '1201', '12'),
('120113', N'Cullhuas', '1201', '12'),
('120114', N'El Tambo', '1201', '12'),
('120116', N'Huacrapuquio', '1201', '12'),
('120117', N'Hualhuas', '1201', '12'),
('120119', N'Huancan', '1201', '12'),
('120120', N'Huasicancha', '1201', '12'),
('120121', N'Huayucachi', '1201', '12'),
('120122', N'Ingenio', '1201', '12'),
('120124', N'Pariahuanca', '1201', '12'),
('120125', N'Pilcomayo', '1201', '12'),
('120126', N'Pucara', '1201', '12'),
('120127', N'Quichuay', '1201', '12'),
('120128', N'Quilcas', '1201', '12'),
('120129', N'San Agustín', '1201', '12'),
('120130', N'San Jerónimo de Tunan', '1201', '12'),
('120132', N'Saño', '1201', '12'),
('120133', N'Sapallanga', '1201', '12'),
('120134', N'Sicaya', '1201', '12'),
('120135', N'Santo Domingo de Acobamba', '1201', '12'),
('120136', N'Viques', '1201', '12'),
('120201', N'Concepción', '1202', '12'),
('120202', N'Aco', '1202', '12'),
('120203', N'Andamarca', '1202', '12'),
('120204', N'Chambara', '1202', '12'),
('120205', N'Cochas', '1202', '12'),
('120206', N'Comas', '1202', '12'),
('120207', N'Heroínas Toledo', '1202', '12'),
('120208', N'Manzanares', '1202', '12'),
('120209', N'Mariscal Castilla', '1202', '12'),
('120210', N'Matahuasi', '1202', '12'),
('120211', N'Mito', '1202', '12'),
('120212', N'Nueve de Julio', '1202', '12'),
('120213', N'Orcotuna', '1202', '12'),
('120214', N'San José de Quero', '1202', '12'),
('120215', N'Santa Rosa de Ocopa', '1202', '12'),
('120301', N'Chanchamayo', '1203', '12'),
('120302', N'Perene', '1203', '12'),
('120303', N'Pichanaqui', '1203', '12'),
('120304', N'San Luis de Shuaro', '1203', '12'),
('120305', N'San Ramón', '1203', '12'),
('120306', N'Vitoc', '1203', '12'),
('120401', N'Jauja', '1204', '12'),
('120402', N'Acolla', '1204', '12'),
('120403', N'Apata', '1204', '12'),
('120404', N'Ataura', '1204', '12'),
('120405', N'Canchayllo', '1204', '12'),
('120406', N'Curicaca', '1204', '12'),
('120407', N'El Mantaro', '1204', '12'),
('120408', N'Huamali', '1204', '12'),
('120409', N'Huaripampa', '1204', '12'),
('120410', N'Huertas', '1204', '12'),
('120411', N'Janjaillo', '1204', '12'),
('120412', N'Julcán', '1204', '12'),
('120413', N'Leonor Ordóñez', '1204', '12'),
('120414', N'Llocllapampa', '1204', '12'),
('120415', N'Marco', '1204', '12'),
('120416', N'Masma', '1204', '12'),
('120417', N'Masma Chicche', '1204', '12'),
('120418', N'Molinos', '1204', '12'),
('120419', N'Monobamba', '1204', '12'),
('120420', N'Muqui', '1204', '12'),
('120421', N'Muquiyauyo', '1204', '12'),
('120422', N'Paca', '1204', '12'),
('120423', N'Paccha', '1204', '12'),
('120424', N'Pancan', '1204', '12'),
('120425', N'Parco', '1204', '12'),
('120426', N'Pomacancha', '1204', '12'),
('120427', N'Ricran', '1204', '12'),
('120428', N'San Lorenzo', '1204', '12'),
('120429', N'San Pedro de Chunan', '1204', '12'),
('120430', N'Sausa', '1204', '12'),
('120431', N'Sincos', '1204', '12'),
('120432', N'Tunan Marca', '1204', '12'),
('120433', N'Yauli', '1204', '12'),
('120434', N'Yauyos', '1204', '12'),
('120501', N'Junin', '1205', '12'),
('120502', N'Carhuamayo', '1205', '12'),
('120503', N'Ondores', '1205', '12'),
('120504', N'Ulcumayo', '1205', '12'),
('120601', N'Satipo', '1206', '12'),
('120602', N'Coviriali', '1206', '12'),
('120603', N'Llaylla', '1206', '12'),
('120604', N'Mazamari', '1206', '12'),
('120605', N'Pampa Hermosa', '1206', '12'),
('120606', N'Pangoa', '1206', '12'),
('120607', N'Río Negro', '1206', '12'),
('120608', N'Río Tambo', '1206', '12'),
('120609', N'Vizcatan del Ene', '1206', '12'),
('120701', N'Tarma', '1207', '12'),
('120702', N'Acobamba', '1207', '12'),
('120703', N'Huaricolca', '1207', '12'),
('120704', N'Huasahuasi', '1207', '12'),
('120705', N'La Unión', '1207', '12'),
('120706', N'Palca', '1207', '12'),
('120707', N'Palcamayo', '1207', '12'),
('120708', N'San Pedro de Cajas', '1207', '12'),
('120709', N'Tapo', '1207', '12'),
('120801', N'La Oroya', '1208', '12'),
('120802', N'Chacapalpa', '1208', '12'),
('120803', N'Huay-Huay', '1208', '12'),
('120804', N'Marcapomacocha', '1208', '12'),
('120805', N'Morococha', '1208', '12'),
('120806', N'Paccha', '1208', '12'),
('120807', N'Santa Bárbara de Carhuacayan', '1208', '12'),
('120808', N'Santa Rosa de Sacco', '1208', '12'),
('120809', N'Suitucancha', '1208', '12'),
('120810', N'Yauli', '1208', '12'),
('120901', N'Chupaca', '1209', '12'),
('120902', N'Ahuac', '1209', '12'),
('120903', N'Chongos Bajo', '1209', '12'),
('120904', N'Huachac', '1209', '12'),
('120905', N'Huamancaca Chico', '1209', '12'),
('120906', N'San Juan de Iscos', '1209', '12'),
('120907', N'San Juan de Jarpa', '1209', '12'),
('120908', N'Tres de Diciembre', '1209', '12'),
('120909', N'Yanacancha', '1209', '12'),
('130101', N'Trujillo', '1301', '13'),
('130102', N'El Porvenir', '1301', '13'),
('130103', N'Florencia de Mora', '1301', '13'),
('130104', N'Huanchaco', '1301', '13'),
('130105', N'La Esperanza', '1301', '13'),
('130106', N'Laredo', '1301', '13'),
('130107', N'Moche', '1301', '13'),
('130108', N'Poroto', '1301', '13'),
('130109', N'Salaverry', '1301', '13'),
('130110', N'Simbal', '1301', '13'),
('130111', N'Victor Larco Herrera', '1301', '13'),
('130201', N'Ascope', '1302', '13'),
('130202', N'Chicama', '1302', '13'),
('130203', N'Chocope', '1302', '13'),
('130204', N'Magdalena de Cao', '1302', '13'),
('130205', N'Paijan', '1302', '13'),
('130206', N'Rázuri', '1302', '13'),
('130207', N'Santiago de Cao', '1302', '13'),
('130208', N'Casa Grande', '1302', '13'),
('130301', N'Bolívar', '1303', '13'),
('130302', N'Bambamarca', '1303', '13'),
('130303', N'Condormarca', '1303', '13'),
('130304', N'Longotea', '1303', '13'),
('130305', N'Uchumarca', '1303', '13'),
('130306', N'Ucuncha', '1303', '13'),
('130401', N'Chepen', '1304', '13'),
('130402', N'Pacanga', '1304', '13'),
('130403', N'Pueblo Nuevo', '1304', '13'),
('130501', N'Julcan', '1305', '13'),
('130502', N'Calamarca', '1305', '13'),
('130503', N'Carabamba', '1305', '13'),
('130504', N'Huaso', '1305', '13'),
('130601', N'Otuzco', '1306', '13'),
('130602', N'Agallpampa', '1306', '13'),
('130604', N'Charat', '1306', '13'),
('130605', N'Huaranchal', '1306', '13'),
('130606', N'La Cuesta', '1306', '13'),
('130608', N'Mache', '1306', '13'),
('130610', N'Paranday', '1306', '13'),
('130611', N'Salpo', '1306', '13'),
('130613', N'Sinsicap', '1306', '13'),
('130614', N'Usquil', '1306', '13'),
('130701', N'San Pedro de Lloc', '1307', '13'),
('130702', N'Guadalupe', '1307', '13'),
('130703', N'Jequetepeque', '1307', '13'),
('130704', N'Pacasmayo', '1307', '13'),
('130705', N'San José', '1307', '13'),
('130801', N'Tayabamba', '1308', '13'),
('130802', N'Buldibuyo', '1308', '13'),
('130803', N'Chillia', '1308', '13'),
('130804', N'Huancaspata', '1308', '13'),
('130805', N'Huaylillas', '1308', '13'),
('130806', N'Huayo', '1308', '13'),
('130807', N'Ongon', '1308', '13'),
('130808', N'Parcoy', '1308', '13'),
('130809', N'Pataz', '1308', '13'),
('130810', N'Pias', '1308', '13'),
('130811', N'Santiago de Challas', '1308', '13'),
('130812', N'Taurija', '1308', '13'),
('130813', N'Urpay', '1308', '13'),
('130901', N'Huamachuco', '1309', '13'),
('130902', N'Chugay', '1309', '13'),
('130903', N'Cochorco', '1309', '13'),
('130904', N'Curgos', '1309', '13'),
('130905', N'Marcabal', '1309', '13'),
('130906', N'Sanagoran', '1309', '13'),
('130907', N'Sarin', '1309', '13'),
('130908', N'Sartimbamba', '1309', '13'),
('131001', N'Santiago de Chuco', '1310', '13'),
('131002', N'Angasmarca', '1310', '13'),
('131003', N'Cachicadan', '1310', '13'),
('131004', N'Mollebamba', '1310', '13'),
('131005', N'Mollepata', '1310', '13'),
('131006', N'Quiruvilca', '1310', '13'),
('131007', N'Santa Cruz de Chuca', '1310', '13'),
('131008', N'Sitabamba', '1310', '13'),
('131101', N'Cascas', '1311', '13'),
('131102', N'Lucma', '1311', '13'),
('131103', N'Marmot', '1311', '13'),
('131104', N'Sayapullo', '1311', '13'),
('131201', N'Viru', '1312', '13'),
('131202', N'Chao', '1312', '13'),
('131203', N'Guadalupito', '1312', '13'),
('140101', N'Chiclayo', '1401', '14'),
('140102', N'Chongoyape', '1401', '14'),
('140103', N'Eten', '1401', '14'),
('140104', N'Eten Puerto', '1401', '14'),
('140105', N'José Leonardo Ortiz', '1401', '14'),
('140106', N'La Victoria', '1401', '14'),
('140107', N'Lagunas', '1401', '14'),
('140108', N'Monsefu', '1401', '14'),
('140109', N'Nueva Arica', '1401', '14'),
('140110', N'Oyotun', '1401', '14'),
('140111', N'Picsi', '1401', '14'),
('140112', N'Pimentel', '1401', '14'),
('140113', N'Reque', '1401', '14'),
('140114', N'Santa Rosa', '1401', '14'),
('140115', N'Saña', '1401', '14'),
('140116', N'Cayalti', '1401', '14'),
('140117', N'Patapo', '1401', '14'),
('140118', N'Pomalca', '1401', '14'),
('140119', N'Pucala', '1401', '14'),
('140120', N'Tuman', '1401', '14'),
('140201', N'Ferreñafe', '1402', '14'),
('140202', N'Cañaris', '1402', '14'),
('140203', N'Incahuasi', '1402', '14'),
('140204', N'Manuel Antonio Mesones Muro', '1402', '14'),
('140205', N'Pitipo', '1402', '14'),
('140206', N'Pueblo Nuevo', '1402', '14'),
('140301', N'Lambayeque', '1403', '14'),
('140302', N'Chochope', '1403', '14'),
('140303', N'Illimo', '1403', '14'),
('140304', N'Jayanca', '1403', '14'),
('140305', N'Mochumi', '1403', '14'),
('140306', N'Morrope', '1403', '14'),
('140307', N'Motupe', '1403', '14'),
('140308', N'Olmos', '1403', '14'),
('140309', N'Pacora', '1403', '14'),
('140310', N'Salas', '1403', '14'),
('140311', N'San José', '1403', '14'),
('140312', N'Tucume', '1403', '14'),
('150101', N'Lima', '1501', '15'),
('150102', N'Ancón', '1501', '15'),
('150103', N'Ate', '1501', '15'),
('150104', N'Barranco', '1501', '15'),
('150105', N'Breña', '1501', '15'),
('150106', N'Carabayllo', '1501', '15'),
('150107', N'Chaclacayo', '1501', '15'),
('150108', N'Chorrillos', '1501', '15'),
('150109', N'Cieneguilla', '1501', '15'),
('150110', N'Comas', '1501', '15'),
('150111', N'El Agustino', '1501', '15'),
('150112', N'Independencia', '1501', '15'),
('150113', N'Jesús María', '1501', '15'),
('150114', N'La Molina', '1501', '15'),
('150115', N'La Victoria', '1501', '15'),
('150116', N'Lince', '1501', '15'),
('150117', N'Los Olivos', '1501', '15'),
('150118', N'Lurigancho', '1501', '15'),
('150119', N'Lurin', '1501', '15'),
('150120', N'Magdalena del Mar', '1501', '15'),
('150121', N'Pueblo Libre', '1501', '15'),
('150122', N'Miraflores', '1501', '15'),
('150123', N'Pachacamac', '1501', '15'),
('150124', N'Pucusana', '1501', '15'),
('150125', N'Puente Piedra', '1501', '15'),
('150126', N'Punta Hermosa', '1501', '15'),
('150127', N'Punta Negra', '1501', '15'),
('150128', N'Rímac', '1501', '15'),
('150129', N'San Bartolo', '1501', '15'),
('150130', N'San Borja', '1501', '15'),
('150131', N'San Isidro', '1501', '15'),
('150132', N'San Juan de Lurigancho', '1501', '15'),
('150133', N'San Juan de Miraflores', '1501', '15'),
('150134', N'San Luis', '1501', '15'),
('150135', N'San Martín de Porres', '1501', '15'),
('150136', N'San Miguel', '1501', '15'),
('150137', N'Santa Anita', '1501', '15'),
('150138', N'Santa María del Mar', '1501', '15'),
('150139', N'Santa Rosa', '1501', '15'),
('150140', N'Santiago de Surco', '1501', '15'),
('150141', N'Surquillo', '1501', '15'),
('150142', N'Villa El Salvador', '1501', '15'),
('150143', N'Villa María del Triunfo', '1501', '15'),
('150201', N'Barranca', '1502', '15'),
('150202', N'Paramonga', '1502', '15'),
('150203', N'Pativilca', '1502', '15'),
('150204', N'Supe', '1502', '15'),
('150205', N'Supe Puerto', '1502', '15'),
('150301', N'Cajatambo', '1503', '15'),
('150302', N'Copa', '1503', '15'),
('150303', N'Gorgor', '1503', '15'),
('150304', N'Huancapon', '1503', '15'),
('150305', N'Manas', '1503', '15'),
('150401', N'Canta', '1504', '15'),
('150402', N'Arahuay', '1504', '15'),
('150403', N'Huamantanga', '1504', '15'),
('150404', N'Huaros', '1504', '15'),
('150405', N'Lachaqui', '1504', '15'),
('150406', N'San Buenaventura', '1504', '15'),
('150407', N'Santa Rosa de Quives', '1504', '15'),
('150501', N'San Vicente de Cañete', '1505', '15'),
('150502', N'Asia', '1505', '15'),
('150503', N'Calango', '1505', '15'),
('150504', N'Cerro Azul', '1505', '15'),
('150505', N'Chilca', '1505', '15'),
('150506', N'Coayllo', '1505', '15'),
('150507', N'Imperial', '1505', '15'),
('150508', N'Lunahuana', '1505', '15'),
('150509', N'Mala', '1505', '15'),
('150510', N'Nuevo Imperial', '1505', '15'),
('150511', N'Pacaran', '1505', '15'),
('150512', N'Quilmana', '1505', '15'),
('150513', N'San Antonio', '1505', '15'),
('150514', N'San Luis', '1505', '15'),
('150515', N'Santa Cruz de Flores', '1505', '15'),
('150516', N'Zúñiga', '1505', '15'),
('150601', N'Huaral', '1506', '15'),
('150602', N'Atavillos Alto', '1506', '15'),
('150603', N'Atavillos Bajo', '1506', '15'),
('150604', N'Aucallama', '1506', '15'),
('150605', N'Chancay', '1506', '15'),
('150606', N'Ihuari', '1506', '15'),
('150607', N'Lampian', '1506', '15'),
('150608', N'Pacaraos', '1506', '15'),
('150609', N'San Miguel de Acos', '1506', '15'),
('150610', N'Santa Cruz de Andamarca', '1506', '15'),
('150611', N'Sumbilca', '1506', '15'),
('150612', N'Veintisiete de Noviembre', '1506', '15'),
('150701', N'Matucana', '1507', '15'),
('150702', N'Antioquia', '1507', '15'),
('150703', N'Callahuanca', '1507', '15'),
('150704', N'Carampoma', '1507', '15'),
('150705', N'Chicla', '1507', '15'),
('150706', N'Cuenca', '1507', '15'),
('150707', N'Huachupampa', '1507', '15'),
('150708', N'Huanza', '1507', '15'),
('150709', N'Huarochiri', '1507', '15'),
('150710', N'Lahuaytambo', '1507', '15'),
('150711', N'Langa', '1507', '15'),
('150712', N'Laraos', '1507', '15'),
('150713', N'Mariatana', '1507', '15'),
('150714', N'Ricardo Palma', '1507', '15'),
('150715', N'San Andrés de Tupicocha', '1507', '15'),
('150716', N'San Antonio', '1507', '15'),
('150717', N'San Bartolomé', '1507', '15'),
('150718', N'San Damian', '1507', '15'),
('150719', N'San Juan de Iris', '1507', '15'),
('150720', N'San Juan de Tantaranche', '1507', '15'),
('150721', N'San Lorenzo de Quinti', '1507', '15'),
('150722', N'San Mateo', '1507', '15'),
('150723', N'San Mateo de Otao', '1507', '15'),
('150724', N'San Pedro de Casta', '1507', '15'),
('150725', N'San Pedro de Huancayre', '1507', '15'),
('150726', N'Sangallaya', '1507', '15'),
('150727', N'Santa Cruz de Cocachacra', '1507', '15'),
('150728', N'Santa Eulalia', '1507', '15'),
('150729', N'Santiago de Anchucaya', '1507', '15'),
('150730', N'Santiago de Tuna', '1507', '15'),
('150731', N'Santo Domingo de Los Olleros', '1507', '15'),
('150732', N'Surco', '1507', '15'),
('150801', N'Huacho', '1508', '15'),
('150802', N'Ambar', '1508', '15'),
('150803', N'Caleta de Carquin', '1508', '15'),
('150804', N'Checras', '1508', '15'),
('150805', N'Hualmay', '1508', '15'),
('150806', N'Huaura', '1508', '15'),
('150807', N'Leoncio Prado', '1508', '15'),
('150808', N'Paccho', '1508', '15'),
('150809', N'Santa Leonor', '1508', '15'),
('150810', N'Santa María', '1508', '15'),
('150811', N'Sayan', '1508', '15'),
('150812', N'Vegueta', '1508', '15'),
('150901', N'Oyon', '1509', '15'),
('150902', N'Andajes', '1509', '15'),
('150903', N'Caujul', '1509', '15'),
('150904', N'Cochamarca', '1509', '15'),
('150905', N'Navan', '1509', '15'),
('150906', N'Pachangara', '1509', '15'),
('151001', N'Yauyos', '1510', '15'),
('151002', N'Alis', '1510', '15'),
('151003', N'Allauca', '1510', '15'),
('151004', N'Ayaviri', '1510', '15'),
('151005', N'Azángaro', '1510', '15'),
('151006', N'Cacra', '1510', '15'),
('151007', N'Carania', '1510', '15'),
('151008', N'Catahuasi', '1510', '15'),
('151009', N'Chocos', '1510', '15'),
('151010', N'Cochas', '1510', '15'),
('151011', N'Colonia', '1510', '15'),
('151012', N'Hongos', '1510', '15'),
('151013', N'Huampara', '1510', '15'),
('151014', N'Huancaya', '1510', '15'),
('151015', N'Huangascar', '1510', '15'),
('151016', N'Huantan', '1510', '15'),
('151017', N'Huañec', '1510', '15'),
('151018', N'Laraos', '1510', '15'),
('151019', N'Lincha', '1510', '15'),
('151020', N'Madean', '1510', '15'),
('151021', N'Miraflores', '1510', '15'),
('151022', N'Omas', '1510', '15'),
('151023', N'Putinza', '1510', '15'),
('151024', N'Quinches', '1510', '15'),
('151025', N'Quinocay', '1510', '15'),
('151026', N'San Joaquín', '1510', '15'),
('151027', N'San Pedro de Pilas', '1510', '15'),
('151028', N'Tanta', '1510', '15'),
('151029', N'Tauripampa', '1510', '15'),
('151030', N'Tomas', '1510', '15'),
('151031', N'Tupe', '1510', '15'),
('151032', N'Viñac', '1510', '15'),
('151033', N'Vitis', '1510', '15'),
('160101', N'Iquitos', '1601', '16'),
('160102', N'Alto Nanay', '1601', '16'),
('160103', N'Fernando Lores', '1601', '16'),
('160104', N'Indiana', '1601', '16'),
('160105', N'Las Amazonas', '1601', '16'),
('160106', N'Mazan', '1601', '16'),
('160107', N'Napo', '1601', '16'),
('160108', N'Punchana', '1601', '16'),
('160110', N'Torres Causana', '1601', '16'),
('160112', N'Belén', '1601', '16'),
('160113', N'San Juan Bautista', '1601', '16'),
('160201', N'Yurimaguas', '1602', '16'),
('160202', N'Balsapuerto', '1602', '16'),
('160205', N'Jeberos', '1602', '16'),
('160206', N'Lagunas', '1602', '16'),
('160210', N'Santa Cruz', '1602', '16'),
('160211', N'Teniente Cesar López Rojas', '1602', '16'),
('160301', N'Nauta', '1603', '16'),
('160302', N'Parinari', '1603', '16'),
('160303', N'Tigre', '1603', '16'),
('160304', N'Trompeteros', '1603', '16'),
('160305', N'Urarinas', '1603', '16'),
('160401', N'Ramón Castilla', '1604', '16'),
('160402', N'Pebas', '1604', '16'),
('160403', N'Yavari', '1604', '16'),
('160404', N'San Pablo', '1604', '16'),
('160501', N'Requena', '1605', '16'),
('160502', N'Alto Tapiche', '1605', '16'),
('160503', N'Capelo', '1605', '16'),
('160504', N'Emilio San Martín', '1605', '16'),
('160505', N'Maquia', '1605', '16'),
('160506', N'Puinahua', '1605', '16'),
('160507', N'Saquena', '1605', '16'),
('160508', N'Soplin', '1605', '16'),
('160509', N'Tapiche', '1605', '16'),
('160510', N'Jenaro Herrera', '1605', '16'),
('160511', N'Yaquerana', '1605', '16'),
('160601', N'Contamana', '1606', '16'),
('160602', N'Inahuaya', '1606', '16'),
('160603', N'Padre Márquez', '1606', '16'),
('160604', N'Pampa Hermosa', '1606', '16'),
('160605', N'Sarayacu', '1606', '16'),
('160606', N'Vargas Guerra', '1606', '16'),
('160701', N'Barranca', '1607', '16'),
('160702', N'Cahuapanas', '1607', '16'),
('160703', N'Manseriche', '1607', '16'),
('160704', N'Morona', '1607', '16'),
('160705', N'Pastaza', '1607', '16'),
('160706', N'Andoas', '1607', '16'),
('160801', N'Putumayo', '1608', '16'),
('160802', N'Rosa Panduro', '1608', '16'),
('160803', N'Teniente Manuel Clavero', '1608', '16'),
('160804', N'Yaguas', '1608', '16'),
('170101', N'Tambopata', '1701', '17'),
('170102', N'Inambari', '1701', '17'),
('170103', N'Las Piedras', '1701', '17'),
('170104', N'Laberinto', '1701', '17'),
('170201', N'Manu', '1702', '17'),
('170202', N'Fitzcarrald', '1702', '17'),
('170203', N'Madre de Dios', '1702', '17'),
('170204', N'Huepetuhe', '1702', '17'),
('170301', N'Iñapari', '1703', '17'),
('170302', N'Iberia', '1703', '17'),
('170303', N'Tahuamanu', '1703', '17'),
('180101', N'Moquegua', '1801', '18'),
('180102', N'Carumas', '1801', '18'),
('180103', N'Cuchumbaya', '1801', '18'),
('180104', N'Samegua', '1801', '18'),
('180105', N'San Cristóbal', '1801', '18'),
('180106', N'Torata', '1801', '18'),
('180201', N'Omate', '1802', '18'),
('180202', N'Chojata', '1802', '18'),
('180203', N'Coalaque', '1802', '18'),
('180204', N'Ichuña', '1802', '18'),
('180205', N'La Capilla', '1802', '18'),
('180206', N'Lloque', '1802', '18'),
('180207', N'Matalaque', '1802', '18'),
('180208', N'Puquina', '1802', '18'),
('180209', N'Quinistaquillas', '1802', '18'),
('180210', N'Ubinas', '1802', '18'),
('180211', N'Yunga', '1802', '18'),
('180301', N'Ilo', '1803', '18'),
('180302', N'El Algarrobal', '1803', '18'),
('180303', N'Pacocha', '1803', '18'),
('190101', N'Chaupimarca', '1901', '19'),
('190102', N'Huachon', '1901', '19'),
('190103', N'Huariaca', '1901', '19'),
('190104', N'Huayllay', '1901', '19'),
('190105', N'Ninacaca', '1901', '19'),
('190106', N'Pallanchacra', '1901', '19'),
('190107', N'Paucartambo', '1901', '19'),
('190108', N'San Francisco de Asís de Yarusyacan', '1901', '19'),
('190109', N'Simon Bolívar', '1901', '19'),
('190110', N'Ticlacayan', '1901', '19'),
('190111', N'Tinyahuarco', '1901', '19'),
('190112', N'Vicco', '1901', '19'),
('190113', N'Yanacancha', '1901', '19'),
('190201', N'Yanahuanca', '1902', '19'),
('190202', N'Chacayan', '1902', '19'),
('190203', N'Goyllarisquizga', '1902', '19'),
('190204', N'Paucar', '1902', '19'),
('190205', N'San Pedro de Pillao', '1902', '19'),
('190206', N'Santa Ana de Tusi', '1902', '19'),
('190207', N'Tapuc', '1902', '19'),
('190208', N'Vilcabamba', '1902', '19'),
('190301', N'Oxapampa', '1903', '19'),
('190302', N'Chontabamba', '1903', '19'),
('190303', N'Huancabamba', '1903', '19'),
('190304', N'Palcazu', '1903', '19'),
('190305', N'Pozuzo', '1903', '19'),
('190306', N'Puerto Bermúdez', '1903', '19'),
('190307', N'Villa Rica', '1903', '19'),
('190308', N'Constitución', '1903', '19'),
('200101', N'Piura', '2001', '20'),
('200104', N'Castilla', '2001', '20'),
('200105', N'Catacaos', '2001', '20'),
('200107', N'Cura Mori', '2001', '20'),
('200108', N'El Tallan', '2001', '20'),
('200109', N'La Arena', '2001', '20'),
('200110', N'La Unión', '2001', '20'),
('200111', N'Las Lomas', '2001', '20'),
('200114', N'Tambo Grande', '2001', '20'),
('200115', N'Veintiseis de Octubre', '2001', '20'),
('200201', N'Ayabaca', '2002', '20'),
('200202', N'Frias', '2002', '20'),
('200203', N'Jilili', '2002', '20'),
('200204', N'Lagunas', '2002', '20'),
('200205', N'Montero', '2002', '20'),
('200206', N'Pacaipampa', '2002', '20'),
('200207', N'Paimas', '2002', '20'),
('200208', N'Sapillica', '2002', '20'),
('200209', N'Sicchez', '2002', '20'),
('200210', N'Suyo', '2002', '20'),
('200301', N'Huancabamba', '2003', '20'),
('200302', N'Canchaque', '2003', '20'),
('200303', N'El Carmen de la Frontera', '2003', '20'),
('200304', N'Huarmaca', '2003', '20'),
('200305', N'Lalaquiz', '2003', '20'),
('200306', N'San Miguel de El Faique', '2003', '20'),
('200307', N'Sondor', '2003', '20'),
('200308', N'Sondorillo', '2003', '20'),
('200401', N'Chulucanas', '2004', '20'),
('200402', N'Buenos Aires', '2004', '20'),
('200403', N'Chalaco', '2004', '20'),
('200404', N'La Matanza', '2004', '20'),
('200405', N'Morropon', '2004', '20'),
('200406', N'Salitral', '2004', '20'),
('200407', N'San Juan de Bigote', '2004', '20'),
('200408', N'Santa Catalina de Mossa', '2004', '20'),
('200409', N'Santo Domingo', '2004', '20'),
('200410', N'Yamango', '2004', '20'),
('200501', N'Paita', '2005', '20'),
('200502', N'Amotape', '2005', '20'),
('200503', N'Arenal', '2005', '20'),
('200504', N'Colan', '2005', '20'),
('200505', N'La Huaca', '2005', '20'),
('200506', N'Tamarindo', '2005', '20'),
('200507', N'Vichayal', '2005', '20'),
('200601', N'Sullana', '2006', '20'),
('200602', N'Bellavista', '2006', '20'),
('200603', N'Ignacio Escudero', '2006', '20'),
('200604', N'Lancones', '2006', '20'),
('200605', N'Marcavelica', '2006', '20'),
('200606', N'Miguel Checa', '2006', '20'),
('200607', N'Querecotillo', '2006', '20'),
('200608', N'Salitral', '2006', '20'),
('200701', N'Pariñas', '2007', '20'),
('200702', N'El Alto', '2007', '20'),
('200703', N'La Brea', '2007', '20'),
('200704', N'Lobitos', '2007', '20'),
('200705', N'Los Organos', '2007', '20'),
('200706', N'Mancora', '2007', '20'),
('200801', N'Sechura', '2008', '20'),
('200802', N'Bellavista de la Unión', '2008', '20'),
('200803', N'Bernal', '2008', '20'),
('200804', N'Cristo Nos Valga', '2008', '20'),
('200805', N'Vice', '2008', '20'),
('200806', N'Rinconada Llicuar', '2008', '20'),
('210101', N'Puno', '2101', '21'),
('210102', N'Acora', '2101', '21'),
('210103', N'Amantani', '2101', '21'),
('210104', N'Atuncolla', '2101', '21'),
('210105', N'Capachica', '2101', '21'),
('210106', N'Chucuito', '2101', '21'),
('210107', N'Coata', '2101', '21'),
('210108', N'Huata', '2101', '21'),
('210109', N'Mañazo', '2101', '21'),
('210110', N'Paucarcolla', '2101', '21'),
('210111', N'Pichacani', '2101', '21'),
('210112', N'Plateria', '2101', '21'),
('210113', N'San Antonio', '2101', '21'),
('210114', N'Tiquillaca', '2101', '21'),
('210115', N'Vilque', '2101', '21'),
('210201', N'Azángaro', '2102', '21'),
('210202', N'Achaya', '2102', '21'),
('210203', N'Arapa', '2102', '21'),
('210204', N'Asillo', '2102', '21'),
('210205', N'Caminaca', '2102', '21'),
('210206', N'Chupa', '2102', '21'),
('210207', N'José Domingo Choquehuanca', '2102', '21'),
('210208', N'Muñani', '2102', '21'),
('210209', N'Potoni', '2102', '21'),
('210210', N'Saman', '2102', '21'),
('210211', N'San Anton', '2102', '21'),
('210212', N'San José', '2102', '21'),
('210213', N'San Juan de Salinas', '2102', '21'),
('210214', N'Santiago de Pupuja', '2102', '21'),
('210215', N'Tirapata', '2102', '21'),
('210301', N'Macusani', '2103', '21'),
('210302', N'Ajoyani', '2103', '21'),
('210303', N'Ayapata', '2103', '21'),
('210304', N'Coasa', '2103', '21'),
('210305', N'Corani', '2103', '21'),
('210306', N'Crucero', '2103', '21'),
('210307', N'Ituata', '2103', '21'),
('210308', N'Ollachea', '2103', '21'),
('210309', N'San Gaban', '2103', '21'),
('210310', N'Usicayos', '2103', '21'),
('210401', N'Juli', '2104', '21'),
('210402', N'Desaguadero', '2104', '21'),
('210403', N'Huacullani', '2104', '21'),
('210404', N'Kelluyo', '2104', '21'),
('210405', N'Pisacoma', '2104', '21'),
('210406', N'Pomata', '2104', '21'),
('210407', N'Zepita', '2104', '21'),
('210501', N'Ilave', '2105', '21'),
('210502', N'Capazo', '2105', '21'),
('210503', N'Pilcuyo', '2105', '21'),
('210504', N'Santa Rosa', '2105', '21'),
('210505', N'Conduriri', '2105', '21'),
('210601', N'Huancane', '2106', '21'),
('210602', N'Cojata', '2106', '21'),
('210603', N'Huatasani', '2106', '21'),
('210604', N'Inchupalla', '2106', '21'),
('210605', N'Pusi', '2106', '21'),
('210606', N'Rosaspata', '2106', '21'),
('210607', N'Taraco', '2106', '21'),
('210608', N'Vilque Chico', '2106', '21'),
('210701', N'Lampa', '2107', '21'),
('210702', N'Cabanilla', '2107', '21'),
('210703', N'Calapuja', '2107', '21'),
('210704', N'Nicasio', '2107', '21'),
('210705', N'Ocuviri', '2107', '21'),
('210706', N'Palca', '2107', '21'),
('210707', N'Paratia', '2107', '21'),
('210708', N'Pucara', '2107', '21'),
('210709', N'Santa Lucia', '2107', '21'),
('210710', N'Vilavila', '2107', '21'),
('210801', N'Ayaviri', '2108', '21'),
('210802', N'Antauta', '2108', '21'),
('210803', N'Cupi', '2108', '21'),
('210804', N'Llalli', '2108', '21'),
('210805', N'Macari', '2108', '21'),
('210806', N'Nuñoa', '2108', '21'),
('210807', N'Orurillo', '2108', '21'),
('210808', N'Santa Rosa', '2108', '21'),
('210809', N'Umachiri', '2108', '21'),
('210901', N'Moho', '2109', '21'),
('210902', N'Conima', '2109', '21'),
('210903', N'Huayrapata', '2109', '21'),
('210904', N'Tilali', '2109', '21'),
('211001', N'Putina', '2110', '21'),
('211002', N'Ananea', '2110', '21'),
('211003', N'Pedro Vilca Apaza', '2110', '21'),
('211004', N'Quilcapuncu', '2110', '21'),
('211005', N'Sina', '2110', '21'),
('211101', N'Juliaca', '2111', '21'),
('211102', N'Cabana', '2111', '21'),
('211103', N'Cabanillas', '2111', '21'),
('211104', N'Caracoto', '2111', '21'),
('211105', N'San Miguel', '2111', '21'),
('211201', N'Sandia', '2112', '21'),
('211202', N'Cuyocuyo', '2112', '21'),
('211203', N'Limbani', '2112', '21'),
('211204', N'Patambuco', '2112', '21'),
('211205', N'Phara', '2112', '21'),
('211206', N'Quiaca', '2112', '21'),
('211207', N'San Juan del Oro', '2112', '21'),
('211208', N'Yanahuaya', '2112', '21'),
('211209', N'Alto Inambari', '2112', '21'),
('211210', N'San Pedro de Putina Punco', '2112', '21'),
('211301', N'Yunguyo', '2113', '21'),
('211302', N'Anapia', '2113', '21'),
('211303', N'Copani', '2113', '21'),
('211304', N'Cuturapi', '2113', '21'),
('211305', N'Ollaraya', '2113', '21'),
('211306', N'Tinicachi', '2113', '21'),
('211307', N'Unicachi', '2113', '21'),
('220101', N'Moyobamba', '2201', '22'),
('220102', N'Calzada', '2201', '22'),
('220103', N'Habana', '2201', '22'),
('220104', N'Jepelacio', '2201', '22'),
('220105', N'Soritor', '2201', '22'),
('220106', N'Yantalo', '2201', '22'),
('220201', N'Bellavista', '2202', '22'),
('220202', N'Alto Biavo', '2202', '22'),
('220203', N'Bajo Biavo', '2202', '22'),
('220204', N'Huallaga', '2202', '22'),
('220205', N'San Pablo', '2202', '22'),
('220206', N'San Rafael', '2202', '22'),
('220301', N'San José de Sisa', '2203', '22'),
('220302', N'Agua Blanca', '2203', '22'),
('220303', N'San Martín', '2203', '22'),
('220304', N'Santa Rosa', '2203', '22'),
('220305', N'Shatoja', '2203', '22'),
('220401', N'Saposoa', '2204', '22'),
('220402', N'Alto Saposoa', '2204', '22'),
('220403', N'El Eslabón', '2204', '22'),
('220404', N'Piscoyacu', '2204', '22'),
('220405', N'Sacanche', '2204', '22'),
('220406', N'Tingo de Saposoa', '2204', '22'),
('220501', N'Lamas', '2205', '22'),
('220502', N'Alonso de Alvarado', '2205', '22'),
('220503', N'Barranquita', '2205', '22'),
('220504', N'Caynarachi', '2205', '22'),
('220505', N'Cuñumbuqui', '2205', '22'),
('220506', N'Pinto Recodo', '2205', '22'),
('220507', N'Rumisapa', '2205', '22'),
('220508', N'San Roque de Cumbaza', '2205', '22'),
('220509', N'Shanao', '2205', '22'),
('220510', N'Tabalosos', '2205', '22'),
('220511', N'Zapatero', '2205', '22'),
('220601', N'Juanjuí', '2206', '22'),
('220602', N'Campanilla', '2206', '22'),
('220603', N'Huicungo', '2206', '22'),
('220604', N'Pachiza', '2206', '22'),
('220605', N'Pajarillo', '2206', '22'),
('220701', N'Picota', '2207', '22'),
('220702', N'Buenos Aires', '2207', '22'),
('220703', N'Caspisapa', '2207', '22'),
('220704', N'Pilluana', '2207', '22'),
('220705', N'Pucacaca', '2207', '22'),
('220706', N'San Cristóbal', '2207', '22'),
('220707', N'San Hilarión', '2207', '22'),
('220708', N'Shamboyacu', '2207', '22'),
('220709', N'Tingo de Ponasa', '2207', '22'),
('220710', N'Tres Unidos', '2207', '22'),
('220801', N'Rioja', '2208', '22'),
('220802', N'Awajun', '2208', '22'),
('220803', N'Elías Soplin Vargas', '2208', '22'),
('220804', N'Nueva Cajamarca', '2208', '22'),
('220805', N'Pardo Miguel', '2208', '22'),
('220806', N'Posic', '2208', '22'),
('220807', N'San Fernando', '2208', '22'),
('220808', N'Yorongos', '2208', '22'),
('220809', N'Yuracyacu', '2208', '22'),
('220901', N'Tarapoto', '2209', '22'),
('220902', N'Alberto Leveau', '2209', '22'),
('220903', N'Cacatachi', '2209', '22');
GO

INSERT INTO Distritos (CodigoDistrito, Nombre, CodigoProvincia, CodigoDepartamento) VALUES
('220904', N'Chazuta', '2209', '22'),
('220905', N'Chipurana', '2209', '22'),
('220906', N'El Porvenir', '2209', '22'),
('220907', N'Huimbayoc', '2209', '22'),
('220908', N'Juan Guerra', '2209', '22'),
('220909', N'La Banda de Shilcayo', '2209', '22'),
('220910', N'Morales', '2209', '22'),
('220911', N'Papaplaya', '2209', '22'),
('220912', N'San Antonio', '2209', '22'),
('220913', N'Sauce', '2209', '22'),
('220914', N'Shapaja', '2209', '22'),
('221001', N'Tocache', '2210', '22'),
('221002', N'Nuevo Progreso', '2210', '22'),
('221003', N'Polvora', '2210', '22'),
('221004', N'Shunte', '2210', '22'),
('221005', N'Uchiza', '2210', '22'),
('230101', N'Tacna', '2301', '23'),
('230102', N'Alto de la Alianza', '2301', '23'),
('230103', N'Calana', '2301', '23'),
('230104', N'Ciudad Nueva', '2301', '23'),
('230105', N'Inclan', '2301', '23'),
('230106', N'Pachia', '2301', '23'),
('230107', N'Palca', '2301', '23'),
('230108', N'Pocollay', '2301', '23'),
('230109', N'Sama', '2301', '23'),
('230110', N'Coronel Gregorio Albarracín Lanchipa', '2301', '23'),
('230111', N'La Yarada los Palos', '2301', '23'),
('230201', N'Candarave', '2302', '23'),
('230202', N'Cairani', '2302', '23'),
('230203', N'Camilaca', '2302', '23'),
('230204', N'Curibaya', '2302', '23'),
('230205', N'Huanuara', '2302', '23'),
('230206', N'Quilahuani', '2302', '23'),
('230301', N'Locumba', '2303', '23'),
('230302', N'Ilabaya', '2303', '23'),
('230303', N'Ite', '2303', '23'),
('230401', N'Tarata', '2304', '23'),
('230402', N'Héroes Albarracín', '2304', '23'),
('230403', N'Estique', '2304', '23'),
('230404', N'Estique-Pampa', '2304', '23'),
('230405', N'Sitajara', '2304', '23'),
('230406', N'Susapaya', '2304', '23'),
('230407', N'Tarucachi', '2304', '23'),
('230408', N'Ticaco', '2304', '23'),
('240101', N'Tumbes', '2401', '24'),
('240102', N'Corrales', '2401', '24'),
('240103', N'La Cruz', '2401', '24'),
('240104', N'Pampas de Hospital', '2401', '24'),
('240105', N'San Jacinto', '2401', '24'),
('240106', N'San Juan de la Virgen', '2401', '24'),
('240201', N'Zorritos', '2402', '24'),
('240202', N'Casitas', '2402', '24'),
('240203', N'Canoas de Punta Sal', '2402', '24'),
('240301', N'Zarumilla', '2403', '24'),
('240302', N'Aguas Verdes', '2403', '24'),
('240303', N'Matapalo', '2403', '24'),
('240304', N'Papayal', '2403', '24'),
('250101', N'Calleria', '2501', '25'),
('250102', N'Campoverde', '2501', '25'),
('250103', N'Iparia', '2501', '25'),
('250104', N'Masisea', '2501', '25'),
('250105', N'Yarinacocha', '2501', '25'),
('250106', N'Nueva Requena', '2501', '25'),
('250107', N'Manantay', '2501', '25'),
('250201', N'Raymondi', '2502', '25'),
('250202', N'Sepahua', '2502', '25'),
('250203', N'Tahuania', '2502', '25'),
('250204', N'Yurua', '2502', '25'),
('250301', N'Padre Abad', '2503', '25'),
('250302', N'Irazola', '2503', '25'),
('250303', N'Curimana', '2503', '25'),
('250304', N'Neshuya', '2503', '25'),
('250305', N'Alexander Von Humboldt', '2503', '25'),
('250401', N'Purus', '2504', '25');
GO

-- ------------------------------------------------------------
-- Nuevas columnas: Ubigeo en Personas y Propietarios, y fecha de
-- nacimiento en Personas.
-- ------------------------------------------------------------
ALTER TABLE Personas ADD
    FechaNacimiento DATE NULL,
    CodigoDistrito  CHAR(6) NULL,
    CONSTRAINT FK_Personas_Distritos FOREIGN KEY (CodigoDistrito) REFERENCES Distritos(CodigoDistrito);
GO

ALTER TABLE Propietarios ADD
    CodigoDistrito CHAR(6) NULL,
    CONSTRAINT FK_Propietarios_Distritos FOREIGN KEY (CodigoDistrito) REFERENCES Distritos(CodigoDistrito);
GO

-- Verificación
SELECT COUNT(*) AS TotalDepartamentos FROM Departamentos;
SELECT COUNT(*) AS TotalProvincias FROM Provincias;
SELECT COUNT(*) AS TotalDistritos FROM Distritos;
SELECT TOP 5 d.Nombre AS Distrito, p.Nombre AS Provincia, dep.Nombre AS Departamento
FROM Distritos d
INNER JOIN Provincias p ON p.CodigoProvincia = d.CodigoProvincia
INNER JOIN Departamentos dep ON dep.CodigoDepartamento = d.CodigoDepartamento;
GO

/* ============================================================
   13. HORARIOS DE TRABAJO DE LOS VETERINARIOS
   Se registran al crear el Usuario (rol Veterinario) en Config >
   Usuarios. citas.controller.js los usa para asignar automáticamente
   un veterinario disponible a cada cita nueva.
   Un veterinario puede trabajar varios días, pero solo UN rango de
   horas por día (UQ_HorariosVeterinario_UsuarioDia).
   ============================================================ */
CREATE TABLE HorariosVeterinario (
    HorarioID    INT IDENTITY(1,1) PRIMARY KEY,
    UsuarioID    INT NOT NULL,
    DiaSemana    TINYINT NOT NULL,   -- 1=Lunes, 2=Martes ... 6=Sábado (nunca 0=Domingo)
    HoraInicio   TIME(0) NOT NULL,
    HoraFin      TIME(0) NOT NULL,
    CONSTRAINT FK_HorariosVeterinario_Usuarios FOREIGN KEY (UsuarioID) REFERENCES Usuarios(UsuarioID),
    CONSTRAINT CK_HorariosVeterinario_Dia CHECK (DiaSemana BETWEEN 1 AND 6),
    CONSTRAINT CK_HorariosVeterinario_Rango CHECK (HoraInicio < HoraFin),
    -- La clínica atiende de 7:00 a. m. a 12:00 a. m. (medianoche): un
    -- veterinario nunca puede empezar antes de que abra. El cierre a
    -- medianoche ya es el límite natural del tipo TIME (máx 23:59:59.9999999),
    -- así que no hace falta un tope superior aparte.
    CONSTRAINT CK_HorariosVeterinario_DentroHorarioClinica
        CHECK (HoraInicio >= '07:00'),
    CONSTRAINT UQ_HorariosVeterinario_UsuarioDia UNIQUE (UsuarioID, DiaSemana)
);
GO

CREATE INDEX IX_HorariosVeterinario_Dia ON HorariosVeterinario(DiaSemana);
GO

-- ============================================================
-- Premier Can - Promociones (2026-09-27)
-- Promociones que publica el Administrativo y que ven los
-- clientes en el portal / app móvil (con notificación).
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO

IF OBJECT_ID('dbo.Promociones', 'U') IS NULL
BEGIN
    CREATE TABLE Promociones (
        PromocionID        INT IDENTITY(1,1) PRIMARY KEY,
        Titulo             NVARCHAR(120)  NOT NULL,
        Etiqueta           NVARCHAR(30)   NULL,          -- ej. '-20%', '2x1', 'GRATIS'
        Categoria          NVARCHAR(40)   NULL,          -- ej. 'Vacunas', 'Baño y grooming'
        Descripcion        NVARCHAR(2000) NOT NULL,
        Condiciones        NVARCHAR(1000) NULL,          -- letra pequeña
        PrecioRegular      DECIMAL(10,2)  NULL,
        PrecioPromocion    DECIMAL(10,2)  NULL,
        FechaInicio        DATE           NOT NULL,      -- fecha literal de Perú
        FechaFin           DATE           NOT NULL,
        ImagenURL          NVARCHAR(300)  NULL,
        Activo             BIT            NOT NULL DEFAULT 1,
        CreadoPor          INT            NOT NULL,
        FechaCreacion      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        FechaActualizacion DATETIME2      NULL,
        CONSTRAINT FK_Promociones_Usuarios FOREIGN KEY (CreadoPor) REFERENCES Usuarios(UsuarioID),
        CONSTRAINT CK_Promociones_Fechas CHECK (FechaFin >= FechaInicio),
        CONSTRAINT CK_Promociones_Precios CHECK (PrecioPromocion IS NULL OR PrecioPromocion >= 0)
    );
    CREATE INDEX IX_Promociones_Vigencia ON Promociones (Activo, FechaInicio, FechaFin);
END
GO


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


-- ============================================================
-- Premier Can - Consulta ligada a la cita + envío de recordatorios (2026-09-27)
--  1) Consultas.CitaID: la consulta registrada desde "Atender" queda
--     ligada a su cita (y una cita solo puede tener UNA consulta).
--  2) Recordatorios.CanalEnvio: por dónde se le avisó al cliente (correo
--     y/o app). La fecha del aviso va en la columna existente EnviadoEn.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.Consultas', 'CitaID') IS NULL
    ALTER TABLE dbo.Consultas ADD CitaID INT NULL
        CONSTRAINT FK_Consultas_Citas FOREIGN KEY REFERENCES dbo.Citas(CitaID);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Consultas_CitaID' AND object_id = OBJECT_ID('dbo.Consultas'))
    CREATE UNIQUE INDEX UX_Consultas_CitaID ON dbo.Consultas (CitaID) WHERE CitaID IS NOT NULL;
GO

IF COL_LENGTH('dbo.Recordatorios', 'CanalEnvio') IS NULL
    ALTER TABLE dbo.Recordatorios ADD CanalEnvio NVARCHAR(30) NULL;  -- ej. 'Correo', 'App', 'Correo+App'
GO

-- 3) Recordatorios.Destino: 'Cliente' (se le envía al dueño por correo/app)
--    o 'Staff' (alerta interna, ej. "X solicitó una cita"): esas NUNCA se
--    le mandan al cliente.
IF COL_LENGTH('dbo.Recordatorios', 'Destino') IS NULL
    ALTER TABLE dbo.Recordatorios ADD Destino NVARCHAR(10) NOT NULL
        CONSTRAINT DF_Recordatorios_Destino DEFAULT 'Cliente'
        CONSTRAINT CK_Recordatorios_Destino CHECK (Destino IN ('Cliente', 'Staff'));
GO
UPDATE dbo.Recordatorios SET Destino = 'Staff'
WHERE Destino = 'Cliente' AND Mensaje LIKE N'%solicitó una cita%';
GO

-- 4) Recordatorio de cita: a qué cita corresponde (para no avisar dos veces)
IF COL_LENGTH('dbo.Recordatorios', 'CitaID') IS NULL
    ALTER TABLE dbo.Recordatorios ADD CitaID INT NULL
        CONSTRAINT FK_Recordatorios_Citas FOREIGN KEY REFERENCES dbo.Citas(CitaID);
GO

-- 5) Recordatorios de cita escalonados: 10 días, 3 días, 1 día y 5 horas antes.
--    Anticipacion = '10d' | '3d' | '1d' | '5h'. Un solo aviso por cita, hito y
--    fecha (si la cita se reprograma, los avisos se vuelven a generar).
IF COL_LENGTH('dbo.Recordatorios', 'Anticipacion') IS NULL
    ALTER TABLE dbo.Recordatorios ADD Anticipacion NVARCHAR(5) NULL;
GO
UPDATE dbo.Recordatorios SET Anticipacion = '1d'
WHERE CitaID IS NOT NULL AND Anticipacion IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Recordatorios_CitaHito' AND object_id = OBJECT_ID('dbo.Recordatorios'))
    CREATE UNIQUE INDEX UX_Recordatorios_CitaHito
        ON dbo.Recordatorios (CitaID, Anticipacion, FechaProgramada)
        WHERE CitaID IS NOT NULL;
GO


-- ============================================================
-- Premier Can - Avisos personalizados (2026-09-27)
-- Desde la pantalla de Recordatorios el personal puede mandar un
-- aviso propio ("Cerramos el lunes por feriado") a un cliente, a
-- todos, o solo a dueños de perros / gatos, por app, correo o ambos,
-- ahora o programado.
--   * TipoRecordatorio 'Aviso'
--   * PacienteID opcional (un aviso general no es de una mascota)
--   * Titulo: título propio del aviso
--   * EnviarPor: 'App' | 'Correo' | 'Ambos' (NULL = ambos)
--   * EnviarDesde: desde cuándo se envía (aviso programado o "Enviar ahora")
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================
USE PremierCanDB;
GO
SET QUOTED_IDENTIFIER ON;
GO

-- Tipo 'Aviso' en la restricción de TipoRecordatorio
DECLARE @ck SYSNAME = (
    SELECT name FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.Recordatorios') AND definition LIKE '%TipoRecordatorio%'
      AND definition NOT LIKE '%Aviso%'
);
IF @ck IS NOT NULL
BEGIN
    EXEC('ALTER TABLE dbo.Recordatorios DROP CONSTRAINT ' + @ck);
    ALTER TABLE dbo.Recordatorios ADD CONSTRAINT CK_Recordatorios_Tipo
        CHECK (TipoRecordatorio IN ('Vacuna', 'Desparasitacion', 'Cita', 'ControlGeneral', 'Aviso'));
END
GO

ALTER TABLE dbo.Recordatorios ALTER COLUMN PacienteID INT NULL;
GO

IF COL_LENGTH('dbo.Recordatorios', 'Titulo') IS NULL
    ALTER TABLE dbo.Recordatorios ADD Titulo NVARCHAR(120) NULL;
GO
IF COL_LENGTH('dbo.Recordatorios', 'EnviarPor') IS NULL
    ALTER TABLE dbo.Recordatorios ADD EnviarPor NVARCHAR(10) NULL
        CONSTRAINT CK_Recordatorios_EnviarPor CHECK (EnviarPor IN ('App', 'Correo', 'Ambos'));
GO
IF COL_LENGTH('dbo.Recordatorios', 'EnviarDesde') IS NULL
    ALTER TABLE dbo.Recordatorios ADD EnviarDesde DATETIME2 NULL;
GO

-- Bienvenida automática: se envía UNA vez, la primera vez que el cliente
-- inicia sesión en el portal / la app.
IF COL_LENGTH('dbo.Propietarios', 'BienvenidaEnviada') IS NULL
    ALTER TABLE dbo.Propietarios ADD BienvenidaEnviada BIT NOT NULL
        CONSTRAINT DF_Propietarios_Bienvenida DEFAULT 0;
GO


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
