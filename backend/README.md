# Premier Can - Backend

API en Node.js + Express que se conecta a la base de datos SQL Server
(`PremierCanDB`) y maneja login + control de acceso por rol.

## Instalación

```bash
cd backend
npm install
cp .env.example .env
```

Edita `.env` con los datos reales de tu SQL Server (usuario `sa`,
contraseña, nombre del servidor, etc).

## Ejecutar

```bash
npm run dev      # con recarga automática (nodemon)
# o
npm start        # producción
```

El servidor queda escuchando en `http://localhost:4000` (o el puerto que
pongas en `PORT`).

## Antes de probar el login

Los usuarios que insertó el script SQL (`admin`, `vet.demo`) tienen un
`ContrasenaHash` de ejemplo que **no sirve para hacer login** — hay que
reemplazarlo por un hash real. Genera uno rápido así:

```bash
node -e "console.log(require('bcryptjs').hashSync('123456', 12))"
```

Copia el resultado y actualízalo en SQL Server:

```sql
UPDATE Usuarios
SET ContrasenaHash = 'PEGA_AQUI_EL_HASH_GENERADO'
WHERE NombreUsuario = 'admin';
```

Repite lo mismo para `vet.demo` (o crea tus propios usuarios).

## Endpoints

### `POST /api/auth/login`
```json
// Body
{ "usuario": "admin", "contrasena": "123456" }

// Respuesta 200
{
  "token": "eyJhbGciOi...",
  "usuario": {
    "usuarioId": 1,
    "nombreCompleto": "Administrador Premier Can",
    "rol": "Administrativo",
    "accesoConfig": true
  }
}
```

### `GET /api/auth/me`
Requiere header `Authorization: Bearer <token>`. Devuelve los datos del
usuario autenticado — el frontend lo usa para confirmar el rol al cargar
cualquier página.

### `GET /api/usuarios`, `POST /api/usuarios`, `PATCH /api/usuarios/:id/estado`
Protegidos con `verifyToken` + `requireConfigAccess`: **solo un usuario
con rol Administrativo puede usarlos.** Si un Veterinario intenta
llamarlos (aunque manipule el frontend), el backend responde `403`.

## Por qué la seguridad va en el backend, no en el HTML

Ocultar el botón "Config" en el sidebar (lo que hace `auth.js` en el
frontend) es solo una mejora de experiencia de usuario — cualquiera
podría editar el HTML/JS del navegador y volver a mostrarlo. La
protección real está en `middleware/auth.js`: aunque alguien llame
directamente a `/api/usuarios` sin pasar por el botón, el servidor
rechaza la petición si el rol no tiene `accesoConfig`.
