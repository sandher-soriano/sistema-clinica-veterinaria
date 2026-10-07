/**
 * assets/js/app-notificaciones.js
 * Solo hace algo dentro de la APP (Capacitor, Android). En el navegador no hace nada.
 *
 * El trabajo pesado lo hace el "runner" en segundo plano de la app
 * (premiercan-app-clientes/www/runners/promociones.js), que cada ~15 minutos,
 * aunque la app esté cerrada, revisa promociones y recordatorios y avisa con
 * una notificación. Este archivo:
 *   1) pide permiso para mostrar notificaciones (Android 13+ lo exige),
 *   2) si el cliente inició sesión, le entrega al runner un token que SOLO
 *      sirve para leer sus recordatorios (dura 6 meses, no es la sesión),
 *   3) pide una revisión inmediata cada vez que se abre / vuelve a la app,
 *   4) al cerrar sesión, le dice al runner que olvide ese token.
 */
(function () {
  const cap = window.Capacitor;
  const esApp = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  // El plugin nativo se registra como "CapacitorBackgroundRunner"
  const runner = esApp && ((cap.Plugins && cap.Plugins.CapacitorBackgroundRunner) ||
    (cap.registerPlugin && cap.registerPlugin('CapacitorBackgroundRunner')));

  const ETIQUETA = 'com.premiercan.clientes.promociones';
  const CLAVE_TOKEN = 'pc_notif_token';
  const RENOVAR_CADA_DIAS = 30;

  const enviarAlRunner = (evento, details = {}) =>
    runner ? runner.dispatchEvent({ label: ETIQUETA, event: evento, details }).catch(() => {}) : Promise.resolve();

  // Lo usa AuthCliente.cerrarSesion(): el celular deja de recibir recordatorios de esta cuenta
  window.PCNotificaciones = {
    olvidar() {
      try { localStorage.removeItem(CLAVE_TOKEN); } catch (e) { /* sin almacenamiento */ }
      return enviarAlRunner('olvidarCliente');
    },
  };

  if (!runner) return;

  async function asegurarPermiso() {
    try {
      const estado = await runner.checkPermissions();
      if (estado.notifications !== 'granted') await runner.requestPermissions({ apis: ['notifications'] });
    } catch (e) { /* si el usuario lo rechaza, la app sigue funcionando sin avisos */ }
  }

  // Con sesión iniciada: consigue (o renueva) el token de notificaciones y se lo da al runner
  async function registrarCliente() {
    // AuthCliente se declara con const en auth-cliente.js: no está en window, pero sí es global
    const sesion = typeof AuthCliente !== 'undefined' ? AuthCliente.obtenerToken() : null;
    if (!sesion) return;
    let guardado = null;
    try { guardado = JSON.parse(localStorage.getItem(CLAVE_TOKEN) || 'null'); } catch (e) { /* nada */ }
    const vigente = guardado && Date.now() - guardado.creado < RENOVAR_CADA_DIAS * 86400000;
    if (vigente) return enviarAlRunner('guardarCliente', { token: guardado.token });

    try {
      const resp = await fetch(`${window.API_BASE_URL}/cliente/app/token-notificaciones`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sesion}` },
      });
      if (!resp.ok) return;
      const { token } = await resp.json();
      try { localStorage.setItem(CLAVE_TOKEN, JSON.stringify({ token, creado: Date.now() })); } catch (e) { /* nada */ }
      await enviarAlRunner('guardarCliente', { token });
    } catch (e) { /* sin conexión: se intenta la próxima vez */ }
  }

  let ultimaRevision = 0;
  function revisarAhora() {
    if (Date.now() - ultimaRevision < 60 * 1000) return; // como mucho una vez por minuto
    ultimaRevision = Date.now();
    enviarAlRunner('revisarNovedades');
  }

  asegurarPermiso().then(registrarCliente).then(revisarAhora);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisarAhora();
  });
})();
