/**
 * assets/js/auth.js
 * Lógica compartida de sesión y control de acceso por rol para todas
 * las páginas del panel administrativo de Premier Can.
 *
 * IMPORTANTE: esto es solo la capa de experiencia de usuario (mostrar u
 * ocultar botones, redirigir si no hay sesión). La seguridad REAL vive
 * en el backend (middleware/auth.js -> requireConfigAccess), porque
 * cualquiera podría editar este archivo desde el navegador.
 */

// En tu propia PC (probando con live-server u otro), el backend vive en
// localhost:4000. Publicado en Azure (o cualquier otro sitio), el backend
// se sirve desde el mismo origen que este HTML (ver server.js, que ahora
// sirve el frontend con express.static) — por eso ahí basta con "/api".
const ES_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = ES_LOCAL ? 'http://localhost:4000/api' : '/api';
// Se expone en window para que otras páginas (pacientes.html, etc.) puedan
// armar URLs de imágenes/archivos sin repetir esta constante.
window.API_BASE_URL = API_BASE_URL;
// Origen del backend sin el "/api" final (ej. http://localhost:4000),
// útil para armar la URL completa de las fotos servidas en /uploads/...
window.BACKEND_ORIGIN = API_BASE_URL.replace(/\/api$/, '');

const Auth = {
  guardarSesion(token, usuario) {
    localStorage.setItem('pc_token', token);
    localStorage.setItem('pc_usuario', JSON.stringify(usuario));
  },

  obtenerToken() {
    return localStorage.getItem('pc_token');
  },

  obtenerUsuario() {
    const raw = localStorage.getItem('pc_usuario');
    return raw ? JSON.parse(raw) : null;
  },

  cerrarSesion() {
    localStorage.removeItem('pc_token');
    localStorage.removeItem('pc_usuario');
    // Ruta relativa: funciona tanto desde /pages/*.html como desde la raíz
    const enRaiz = !window.location.pathname.includes('/pages/');
    window.location.href = enRaiz ? 'index.html' : '../index.html';
  },

  /**
   * Token del "dispositivo de confianza" (para no pedir el doble factor
   * cada vez que se entra desde el mismo navegador). Vive en localStorage
   * porque, a diferencia de la sesión, tiene que sobrevivir más de 8h.
   */
  obtenerDispositivoToken() {
    return localStorage.getItem('pc_device_token');
  },
  guardarDispositivoToken(token) {
    if (token) localStorage.setItem('pc_device_token', token);
  },

  /**
   * Llama a /api/auth/login. Devuelve { token, usuario } o lanza error
   * con el mensaje que mandó el backend. Manda también el token de
   * dispositivo guardado (si existe) para que el backend decida si
   * puede saltarse el doble factor.
   */
  async login(usuario, contrasena) {
    const resp = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, contrasena, dispositivoToken: this.obtenerDispositivoToken() }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.mensaje || 'No se pudo iniciar sesión.');
    }
    return data;
  },

  /**
   * Helper genérico para llamar a endpoints protegidos, agregando
   * automáticamente el header Authorization con el token guardado.
   * Lanza un Error con el mensaje del backend si la respuesta no es OK.
   * Corta la espera a los 20s (por si el backend está reiniciando o la
   * base de datos tarda en reconectar) en vez de quedarse "Cargando..."
   * para siempre.
   */
  apiFetch(path, options = {}) {
    // Guardados idénticos simultáneos (doble clic) se envían una sola vez (cargando.js)
    const ejecutar = () => this._apiFetchReal(path, options);
    const clave = `${options.method || 'GET'}|${path}|${typeof options.body === 'string' ? options.body : ''}`;
    return window.pcSinDuplicar ? window.pcSinDuplicar(options.method, clave, ejecutar) : ejecutar();
  },

  async _apiFetchReal(path, options = {}) {
    const token = this.obtenerToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), 20000);

    let resp;
    try {
      resp = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, signal: timeoutController.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('El servidor está tardando demasiado en responder. Verifica que el backend y la base de datos estén encendidos, y vuelve a intentar.');
      }
      throw new Error('No se pudo conectar con el servidor. Verifica que el backend esté corriendo.');
    } finally {
      clearTimeout(timeoutId);
    }

    // Sesión vencida o inválida -> mandamos al login
    if (resp.status === 401) {
      this.cerrarSesion();
      throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
    }

    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      // Respuesta sin body (poco común, pero no debe romper el flujo)
    }

    if (!resp.ok) {
      throw new Error((data && data.mensaje) || 'Ocurrió un error al comunicarse con el servidor.');
    }
    return data;
  },

  /**
   * GET /api/usuarios (requiere rol Administrativo).
   * Devuelve el arreglo de usuarios con su rol.
   */
  listarUsuarios() {
    return this.apiFetch('/usuarios');
  },

  /**
   * POST /api/usuarios
   * datos = { personaId, nombreUsuario, contrasena, rolId }
   * Ya NO se manda nombreCompleto/correo: se elige una Persona ya
   * registrada (ver listarPersonas) y el backend hereda sus datos.
   */
  crearUsuario(datos) {
    return this.apiFetch('/usuarios', {
      method: 'POST',
      body: JSON.stringify(datos),
    });
  },

  /**
   * PATCH /api/usuarios/:id/estado
   * activo = true | false
   * esCliente = true si esa fila es un cliente del portal (Propietarios),
   * no personal de la clínica (Usuarios) — el backend necesita saberlo
   * para actualizar la tabla correcta.
   */
  cambiarEstadoUsuario(usuarioId, activo, esCliente = false) {
    return this.apiFetch(`/usuarios/${usuarioId}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ activo, esCliente }),
    });
  },

  /**
   * GET /api/personas (requiere rol Administrativo).
   * Devuelve el personal contratado, con TieneUsuario indicando si esa
   * persona ya tiene un Usuario de sistema asignado.
   */
  listarPersonas() {
    return this.apiFetch('/personas');
  },

  /**
   * POST /api/personas
   * datos = { nombres, apellidos, numeroDocumento?, telefono?, correo, direccion?, fechaContratacion? }
   * Registra a alguien contratado. Todavía SIN acceso al sistema — el
   * acceso se da aparte, en "Crear usuario", eligiendo esta persona.
   */
  crearPersona(datos) {
    return this.apiFetch('/personas', {
      method: 'POST',
      body: JSON.stringify(datos),
    });
  },

  /**
   * PUT /api/personas/:id
   */
  actualizarPersona(personaId, datos) {
    return this.apiFetch(`/personas/${personaId}`, {
      method: 'PUT',
      body: JSON.stringify(datos),
    });
  },

  /**
   * PATCH /api/personas/:id/estado
   * Si se desactiva, el backend también desactiva su Usuario (si tenía).
   */
  cambiarEstadoPersona(personaId, activo) {
    return this.apiFetch(`/personas/${personaId}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ activo }),
    });
  },

  /**
   * GET /api/propietarios/validar-dni/:dni
   * Se llama antes de guardar un propietario nuevo. Devuelve
   * { valido, nombres?, apellidos?, mensaje? } — si valido es true, el
   * DNI existe según RENIEC y trae el nombre real para autocompletar.
   */
  validarDniPropietario(dni) {
    return this.apiFetch(`/propietarios/validar-dni/${dni}`);
  },

  /**
   * Catálogo de Ubigeo (Departamento -> Provincia -> Distrito), usado
   * para armar la dirección de Personas y Propietarios en cascada.
   */
  listarDepartamentos() {
    return this.apiFetch('/ubigeo/departamentos');
  },
  listarProvincias(codigoDepartamento) {
    return this.apiFetch(`/ubigeo/provincias/${codigoDepartamento}`);
  },
  listarDistritos(codigoProvincia) {
    return this.apiFetch(`/ubigeo/distritos/${codigoProvincia}`);
  },

  /**
   * GET /api/utilidades/validar-correo/:correo
   * Verifica que el DOMINIO del correo tenga servidor de correo real
   * (registros MX) — no confirma que la casilla específica exista.
   * Devuelve { valido: true|false|null, mensaje? }.
   */
  verificarCorreo(correo) {
    return this.apiFetch(`/utilidades/validar-correo/${encodeURIComponent(correo)}`);
  },

  /**
   * PATCH /api/pacientes/:id/estado
   * Activar/desactivar un paciente (nunca se elimina).
   */
  cambiarEstadoPaciente(pacienteId, activo) {
    return this.apiFetch(`/pacientes/${pacienteId}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ activo }),
    });
  },

  /**
   * GET /api/pacientes/:id/auditoria
   * Historial de quién registró/editó/activó/desactivó a ese paciente.
   */
  obtenerAuditoriaPaciente(pacienteId) {
    return this.apiFetch(`/pacientes/${pacienteId}/auditoria`);
  },

  /**
   * Debe llamarse al cargar CUALQUIER página interna (dashboard, pacientes, etc).
   * - Si no hay sesión, redirige al login.
   * - Si hay sesión, oculta los ítems de Config/Personal del sidebar
   *   cuando el rol no tenga accesoConfig (Veterinario).
   */
  protegerPagina() {
    const token = this.obtenerToken();
    const usuario = this.obtenerUsuario();

    if (!token || !usuario) {
      window.location.href = '../index.html';
      return null;
    }

    if (!usuario.accesoConfig) {
      document.getElementById('navConfigItem')?.remove();
      document.getElementById('navPersonalItem')?.remove();
      document.getElementById('navPromocionesItem')?.remove();
    }

    return usuario;
  },

  /**
   * Guardia extra para usuarios.html, personas.html y promociones.html: si un Veterinario
   * entra directamente por URL (sin pasar por el sidebar), lo saca de
   * la página.
   */
  protegerPaginaConfig() {
    const usuario = this.protegerPagina();
    if (usuario && !usuario.accesoConfig) {
      alert('No tienes permisos para acceder a esta sección.');
      window.location.href = 'dashboard.html';
    }
  },
};

/**
 * Menú lateral en celular: se activa solo si la página tiene un elemento
 * con id="sidebarNav" (el <nav> del menú) y uno con id="btnAbrirMenuMovil"
 * (el botón flotante ☰). No hace falta llamarlo a mano — corre solo en
 * cuanto el HTML termina de cargar, y si esos elementos no existen en la
 * página (como en el login o el portal de clientes), simplemente no hace nada.
 */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnCerrarSesion')?.addEventListener('click', () => Auth.cerrarSesion());
  document.getElementById('logoutBtn')?.addEventListener('click', () => Auth.cerrarSesion());

  const nav = document.getElementById('sidebarNav');
  const botonAbrir = document.getElementById('btnAbrirMenuMovil');
  const backdrop = document.getElementById('backdropMenuMovil');
  if (!nav || !botonAbrir || !backdrop) return;

  function abrirMenu() {
    nav.classList.remove('hidden');
    nav.classList.add('flex');
    backdrop.classList.remove('hidden');
  }
  function cerrarMenu() {
    nav.classList.add('hidden');
    nav.classList.remove('flex');
    backdrop.classList.add('hidden');
  }
  function alternarMenu() {
    const abierto = !nav.classList.contains('hidden');
    if (abierto) cerrarMenu(); else abrirMenu();
  }

  // El mismo botón sirve para abrir Y cerrar (toca una vez -> abre,
  // toca de nuevo con el menú ya abierto -> cierra).
  botonAbrir.addEventListener('click', alternarMenu);
  backdrop.addEventListener('click', cerrarMenu);
  // Si tocan un link del menú, se cierra solo (aunque la página va a
  // recargar de todos modos, evita el parpadeo del menú abierto).
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', cerrarMenu));
});