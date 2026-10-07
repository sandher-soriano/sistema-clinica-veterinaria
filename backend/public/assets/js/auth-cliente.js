/**
 * assets/js/auth-cliente.js
 * Sesión para el PORTAL DE CLIENTES (dueños de mascotas).
 * Separado de assets/js/auth.js (el del staff) para que ambas sesiones
 * puedan convivir en el mismo navegador sin pisarse.
 */

// Igual que en auth.js: local usa localhost:4000, publicado usa ruta
// relativa porque el backend sirve este mismo frontend (express.static).
const ES_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = ES_LOCAL ? 'http://localhost:4000/api' : '/api';
window.API_BASE_URL = window.API_BASE_URL || API_BASE_URL;
window.BACKEND_ORIGIN = window.BACKEND_ORIGIN || API_BASE_URL.replace(/\/api$/, '');

const AuthCliente = {
  guardarSesion(token, propietario) {
    localStorage.setItem('pc_cliente_token', token);
    localStorage.setItem('pc_cliente_propietario', JSON.stringify(propietario));
  },

  obtenerToken() {
    return localStorage.getItem('pc_cliente_token');
  },

  obtenerPropietario() {
    const raw = localStorage.getItem('pc_cliente_propietario');
    return raw ? JSON.parse(raw) : null;
  },

  /**
   * olvidarDispositivo = true (botón "Cerrar sesión"): además, en la app, el
   * celular deja de recibir los recordatorios de esta cuenta.
   * Si la sesión solo venció (apiFetch recibió 401), NO se apagan los
   * recordatorios: el cliente sigue siendo el dueño de ese celular.
   */
  cerrarSesion({ olvidarDispositivo = true } = {}) {
    localStorage.removeItem('pc_cliente_token');
    localStorage.removeItem('pc_cliente_propietario');
    if (olvidarDispositivo && window.PCNotificaciones) window.PCNotificaciones.olvidar();
    window.location.href = 'login.html';
  },

  // recordar = true: "Recordar este dispositivo por 30 días"
  async login(correo, contrasena, recordar = false) {
    const resp = await fetch(`${API_BASE_URL}/cliente/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, contrasena, recordar }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.mensaje || 'No se pudo iniciar sesión.');
    return data;
  },

  /**
   * Llama a cualquier endpoint /api/cliente/... agregando el token
   * automáticamente. Si la sesión venció, manda de regreso al login.
   */
  apiFetch(path, options = {}) {
    // Guardados idénticos simultáneos (doble clic) se envían una sola vez (cargando.js)
    const ejecutar = () => this._apiFetchReal(path, options);
    const clave = `${options.method || 'GET'}|${path}|${typeof options.body === 'string' ? options.body : ''}`;
    return window.pcSinDuplicar ? window.pcSinDuplicar(options.method, clave, ejecutar) : ejecutar();
  },

  async _apiFetchReal(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.obtenerToken()}`,
      ...(options.headers || {}),
    };
    const resp = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

    if (resp.status === 401) {
      this.cerrarSesion({ olvidarDispositivo: false });
      throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
    }
    const data = await resp.json();
    if (!resp.ok) {
      const error = new Error(data.mensaje || 'Ocurrió un error.');
      error.datos = data; // ej. sugerencias de horarios libres al agendar
      throw error;
    }
    return data;
  },

  /**
   * Llamar al cargar CUALQUIER página interna del portal de clientes.
   * Si no hay sesión, manda al login. Si el cliente todavía tiene una
   * contraseña TEMPORAL (se la puso el admin), lo manda primero a
   * cambiarla — no lo deja usar el resto del portal hasta que lo haga.
   */
  protegerPagina() {
    const token = this.obtenerToken();
    const propietario = this.obtenerPropietario();
    if (!token || !propietario) {
      window.location.href = 'login.html';
      return null;
    }

    const esPaginaCambioPassword = window.location.pathname.endsWith('cambiar-password-inicial.html');
    if (propietario.debeCambiarPassword && !esPaginaCambioPassword) {
      window.location.href = 'cambiar-password-inicial.html';
      return null;
    }

    return propietario;
  },
};