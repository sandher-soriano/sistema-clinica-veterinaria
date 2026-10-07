/**
 * assets/js/cargando.js
 * Pantalla de carga de Premier Can. Va como PRIMER script del <head> de cada
 * página (sin defer): así cubre la página antes del primer dibujo y oculta el
 * "parpadeo" mientras Tailwind (CDN) y las fuentes terminan de cargar.
 *
 *  - Versión completa (fondo turquesa, logo, huellitas caminando, frases):
 *    la primera página de la sesión del navegador y justo después de iniciar
 *    sesión.
 *  - Versión ligera (fondo claro, logo latiendo): al navegar entre páginas;
 *    desaparece apenas la página está lista.
 *
 * API: window.PCCarga.mostrar('Texto…')  -> muestra la versión completa (p. ej.
 *      antes de redirigir tras el login). window.PCCarga.siguienteCompleta()
 *      -> la próxima página abrirá con la versión completa.
 */
(function () {
  'use strict';
  var html = document.documentElement;

  // ---------------- Seguridad: escapar texto antes de meterlo en HTML ----------------
  // Todo dato que viene de la base (nombres, motivos, diagnósticos, mensajes...)
  // debe pasar por escHtml() antes de ir dentro de un innerHTML: así un texto
  // como <img src=x onerror=...> se muestra tal cual y NUNCA se ejecuta (XSS).
  // Vive aquí porque este archivo es el primer script de TODAS las páginas.
  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  window.escHtml = function (valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/[&<>"'`]/g, function (c) { return ESCAPES[c]; });
  };

  // ---------------- WhatsApp: enlace con mensaje ya escrito ----------------
  // Celular peruano de 9 dígitos -> +51. Devuelve null si el número no sirve.
  // Se envía desde el WhatsApp de la clínica (no necesita cuenta ni API de pago).
  window.pcEnlaceWhatsApp = function (telefono, texto) {
    var num = String(telefono || '').replace(/\D/g, '');
    if (num.length === 9 && num.charAt(0) === '9') num = '51' + num;
    if (num.length < 11) return null;
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(texto || '');
  };

  // ---------------- Evitar guardados dobles (doble clic) ----------------
  // Auth.apiFetch / AuthCliente.apiFetch pasan por aquí: si llega una petición
  // de guardado IDÉNTICA mientras la primera sigue en curso, se reutiliza la
  // primera (no se manda dos veces: antes un doble clic creaba dos consultas o
  // dos citas). Además el botón presionado queda deshabilitado mientras guarda.
  var enCurso = {};
  window.pcSinDuplicar = function (metodo, clave, ejecutar) {
    if (!/^(POST|PUT|PATCH|DELETE)$/i.test(metodo || 'GET')) return ejecutar();
    if (enCurso[clave]) return enCurso[clave];
    var activo = document.activeElement;
    var boton = activo && activo.closest ? activo.closest('button') : null;
    if (boton && boton.disabled) boton = null;
    if (boton) { boton.disabled = true; boton.classList.add('pc-guardando'); }
    var promesa = Promise.resolve().then(ejecutar);
    enCurso[clave] = promesa;
    var terminar = function () {
      delete enCurso[clave];
      if (boton) { boton.disabled = false; boton.classList.remove('pc-guardando'); }
    };
    promesa.then(terminar, terminar);
    return promesa;
  };

  var CLAVE_VISTO = 'pc_splash_visto';
  var CLAVE_COMPLETA = 'pc_splash_completa';

  function leer(clave) { try { return sessionStorage.getItem(clave); } catch (e) { return null; } }
  function escribir(clave, valor) {
    try { if (valor === null) sessionStorage.removeItem(clave); else sessionStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento */ }
  }

  // ---------------- Tema claro / oscuro (antes del primer dibujo: sin destello blanco) ----------------
  var CLAVE_TEMA = 'pc_tema';
  var temaGuardado = null;
  try { temaGuardado = localStorage.getItem(CLAVE_TEMA); } catch (e) { /* sin almacenamiento */ }
  var sistemaOscuro = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (temaGuardado ? temaGuardado === 'oscuro' : sistemaOscuro) html.classList.add('pc-oscuro');

  window.PCTema = {
    esOscuro: function () { return html.classList.contains('pc-oscuro'); },
    poner: function (oscuro) {
      html.classList.toggle('pc-oscuro', !!oscuro);
      try { localStorage.setItem(CLAVE_TEMA, oscuro ? 'oscuro' : 'claro'); } catch (e) { /* sin almacenamiento */ }
      try { window.dispatchEvent(new CustomEvent('pc:tema', { detail: { oscuro: !!oscuro } })); } catch (e) { /* navegador antiguo */ }
    }
  };

  // Al imprimir / exportar a PDF siempre se usa el tema claro (ahorra tinta y se lee mejor)
  var oscuroAntesDeImprimir = false;
  window.addEventListener('beforeprint', function () {
    oscuroAntesDeImprimir = html.classList.contains('pc-oscuro');
    html.classList.remove('pc-oscuro');
  });
  window.addEventListener('afterprint', function () {
    if (oscuroAntesDeImprimir) html.classList.add('pc-oscuro');
  });

  var forzada = leer(CLAVE_COMPLETA) === '1';
  var completa = forzada || !leer(CLAVE_VISTO);
  escribir(CLAVE_VISTO, '1');
  escribir(CLAVE_COMPLETA, null);

  // Ruta de las imágenes, relativa a este mismo archivo (sirve en / y en /pages/, /cliente/)
  var script = document.currentScript;
  var base = script && script.src ? script.src.replace(/js\/cargando\.js.*$/, '') : 'assets/';
  var LOGO = base + 'img/Logo2.jpg';

  var reducido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- Estilos (en línea: deben existir antes que cualquier hoja) ----------------
  var css = [
    '.pcs{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;visibility:visible!important;overflow:hidden;',
    'font-family:"Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .55s cubic-bezier(.4,0,.2,1),transform .7s cubic-bezier(.4,0,.2,1),filter .55s ease;}',
    '.pcs--full{color:#fff;background:radial-gradient(1200px 700px at 15% 10%,#13909d 0%,transparent 60%),radial-gradient(900px 600px at 90% 95%,#0a5560 0%,transparent 60%),linear-gradient(150deg,#0d7a87 0%,#00606a 45%,#003f46 100%);}',
    '.pcs--lite{color:#00606a;background:#f4f8f9;}',
    /* Modo oscuro: negro verdoso con brillos esmeralda */
    'html.pc-oscuro .pcs--full{background:radial-gradient(1000px 640px at 15% 10%,rgba(16,185,129,.32) 0%,transparent 60%),radial-gradient(800px 560px at 90% 95%,rgba(61,220,151,.18) 0%,transparent 60%),linear-gradient(150deg,#0c1a17 0%,#07100e 55%,#030706 100%);}',
    'html.pc-oscuro .pcs--lite{background:#0a1311;color:#3ddc97;}',
    'html.pc-oscuro .pcs--lite .pcs-huellas svg{fill:#3ddc97;}',
    'html.pc-oscuro .pcs--lite .pcs-anillo{border-color:rgba(61,220,151,.4);}',
    'html.pc-oscuro .pcs--lite .pcs-logo img{box-shadow:0 0 0 5px rgba(61,220,151,.12),0 0 40px -6px rgba(61,220,151,.45);}',
    'html.pc-oscuro .pcs-barra span{background:linear-gradient(90deg,#10b981,#3ddc97,#a7f3d0);}',
    '.pcs.pcs-out{opacity:0;transform:scale(1.06);filter:blur(6px);pointer-events:none;}',
    '.pcs--lite.pcs-out{transform:none;filter:none;transition-duration:.28s;}',
    /* Burbujas de luz que flotan en el fondo */
    '.pcs-blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;animation:pcs-flotar 9s ease-in-out infinite alternate;}',
    '.pcs-blob.b1{width:420px;height:420px;left:-120px;top:-100px;background:#58d6a7;opacity:.28;}',
    '.pcs-blob.b2{width:360px;height:360px;right:-90px;bottom:-110px;background:#7dd4e2;opacity:.35;animation-delay:-3s;}',
    '.pcs-blob.b3{width:260px;height:260px;left:55%;top:12%;background:#f2c14e;opacity:.16;animation-delay:-6s;}',
    '@keyframes pcs-flotar{from{transform:translate(0,0) scale(1)}to{transform:translate(40px,30px) scale(1.12)}}',
    /* Huellitas gigantes de decoración */
    '.pcs-deco{position:absolute;width:180px;height:180px;opacity:.07;fill:#fff;}',
    '.pcs-deco.d1{left:6%;bottom:8%;transform:rotate(-24deg);}',
    '.pcs-deco.d2{right:8%;top:9%;width:120px;height:120px;transform:rotate(18deg);}',
    '.pcs-centro{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:24px;}',
    /* Logo con anillos que laten */
    '.pcs-logo{position:relative;width:124px;height:124px;display:grid;place-items:center;margin-bottom:26px;animation:pcs-entrar .8s cubic-bezier(.2,.9,.3,1.3) both;}',
    '.pcs--lite .pcs-logo{width:84px;height:84px;margin-bottom:18px;animation:pcs-latir 1.6s ease-in-out infinite;}',
    '.pcs-logo img{position:relative;z-index:2;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#fff;padding:6px;',
    'box-shadow:0 0 0 6px rgba(255,255,255,.14),0 24px 50px -16px rgba(0,0,0,.55);}',
    '.pcs--lite .pcs-logo img{box-shadow:0 0 0 5px rgba(13,122,135,.08),0 16px 34px -14px rgba(0,96,106,.45);padding:4px;}',
    '.pcs-anillo{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,255,255,.55);animation:pcs-onda 2.4s cubic-bezier(.2,.6,.3,1) infinite;}',
    '.pcs-anillo.a2{animation-delay:.8s}.pcs-anillo.a3{animation-delay:1.6s}',
    '.pcs--lite .pcs-anillo{border-color:rgba(13,122,135,.35);}',
    '@keyframes pcs-onda{0%{transform:scale(1);opacity:.9}100%{transform:scale(2.1);opacity:0}}',
    '@keyframes pcs-entrar{from{transform:scale(.4) rotate(-20deg);opacity:0}to{transform:none;opacity:1}}',
    '@keyframes pcs-latir{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}',
    /* Huellita que gira alrededor del logo */
    '.pcs-orbita{position:absolute;inset:-22px;z-index:3;animation:pcs-girar 3.2s linear infinite;}',
    '.pcs-orbita svg{position:absolute;top:0;left:50%;width:22px;height:22px;margin-left:-11px;fill:#f2c14e;filter:drop-shadow(0 3px 6px rgba(0,0,0,.3));transform:rotate(90deg);}',
    '@keyframes pcs-girar{to{transform:rotate(360deg)}}',
    '.pcs-titulo{margin:0;font:800 clamp(30px,5vw,44px)/1.05 "Manrope",system-ui,sans-serif;letter-spacing:-.02em;animation:pcs-subir .7s .15s cubic-bezier(.2,.8,.2,1) both;}',
    '.pcs-titulo span{background:linear-gradient(90deg,#fff 0%,#c9f3ea 40%,#fff 60%,#9ee7d1 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:pcs-brillo 3s linear infinite;}',
    '.pcs-sub{margin:8px 0 0;font-size:13px;font-weight:600;letter-spacing:.32em;text-transform:uppercase;opacity:.75;animation:pcs-subir .7s .25s cubic-bezier(.2,.8,.2,1) both;}',
    '@keyframes pcs-subir{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    '@keyframes pcs-brillo{to{background-position:-200% 0}}',
    /* Huellitas caminando */
    '.pcs-huellas{display:flex;gap:14px;align-items:center;height:46px;margin:30px 0 22px;}',
    '.pcs--lite .pcs-huellas{margin:4px 0 0;height:30px;gap:9px;}',
    '.pcs-huellas svg{width:22px;height:22px;fill:currentColor;opacity:0;animation:pcs-paso 2.4s ease-in-out infinite;}',
    '.pcs--full .pcs-huellas svg{fill:#c9f3ea;}',
    '.pcs--lite .pcs-huellas svg{width:16px;height:16px;fill:#0d7a87;}',
    '.pcs-huellas svg:nth-child(odd){transform:translateY(-9px) rotate(90deg);}',
    '.pcs-huellas svg:nth-child(even){transform:translateY(9px) rotate(90deg);}',
    '.pcs--lite .pcs-huellas svg:nth-child(odd){transform:translateY(-5px) rotate(90deg);}',
    '.pcs--lite .pcs-huellas svg:nth-child(even){transform:translateY(5px) rotate(90deg);}',
    '@keyframes pcs-paso{0%,8%{opacity:0;scale:.6}18%,55%{opacity:1;scale:1}75%,100%{opacity:0;scale:1}}',
    /* Barra de progreso */
    '.pcs-barra{position:relative;width:min(260px,70vw);height:6px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden;}',
    '.pcs-barra span{position:absolute;inset:0;width:40%;border-radius:inherit;background:linear-gradient(90deg,#58d6a7,#f2c14e);box-shadow:0 0 14px rgba(88,214,167,.8);animation:pcs-cargar 1.4s cubic-bezier(.6,0,.4,1) infinite;}',
    '.pcs-listo .pcs-barra span{animation:none;width:100%;transition:width .35s ease;}',
    '@keyframes pcs-cargar{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}',
    '.pcs-frase{margin:16px 0 0;min-height:20px;font-size:14.5px;font-weight:500;opacity:.88;transition:opacity .3s ease,transform .3s ease;}',
    '.pcs-frase.cambiando{opacity:0;transform:translateY(6px);}',
    '@media (max-width:480px){.pcs-logo{width:104px;height:104px}.pcs-huellas{gap:10px}}',
    '@media (prefers-reduced-motion:reduce){.pcs *,.pcs{animation:none!important;transition-duration:.01s!important}.pcs-huellas svg{opacity:1}}'
  ].join('');

  var estilo = document.createElement('style');
  estilo.id = 'pcs-estilos';
  estilo.textContent = css;
  (document.head || html).appendChild(estilo);

  // ---------------- Contenido ----------------
  var HUELLA = '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="41" rx="12" ry="10"/><ellipse cx="17" cy="28" rx="5" ry="6.5" transform="rotate(-20 17 28)"/><ellipse cx="26" cy="19" rx="5" ry="6.5" transform="rotate(-6 26 19)"/><ellipse cx="38" cy="19" rx="5" ry="6.5" transform="rotate(6 38 19)"/><ellipse cx="47" cy="28" rx="5" ry="6.5" transform="rotate(20 47 28)"/></svg>';

  function primerNombre() {
    try {
      var u = JSON.parse(localStorage.getItem('pc_usuario') || 'null');
      var p = JSON.parse(localStorage.getItem('pc_cliente_propietario') || 'null');
      var nombre = (u && u.nombreCompleto) || (p && (p.nombres || p.Nombres || p.nombreCompleto)) || '';
      // Se salta títulos como "Dra." o "Dr." para saludar por el nombre
      var partes = nombre.trim().split(/\s+/).filter(function (x) { return !/^(dr|dra|lic|sr|sra|srta)\.?$/i.test(x); });
      return partes[0] || '';
    } catch (e) { return ''; }
  }

  var FRASES = [
    'Preparando todo para tus peluditos…',
    'Despertando a Max y a Luna 🐶🐱',
    'Ordenando las historias clínicas…',
    'Revisando las citas del día…',
    'Llenando el plato de croquetas…'
  ];

  function construir(modo, textoInicial) {
    var div = document.createElement('div');
    div.id = 'pc-splash';
    div.className = 'pcs pcs--' + modo;
    div.setAttribute('role', 'status');
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-label', 'Cargando Premier Can');
    var huellas = '';
    for (var i = 0; i < (modo === 'full' ? 7 : 5); i++) {
      huellas += HUELLA.replace('<svg ', '<svg style="animation-delay:' + (i * 0.22).toFixed(2) + 's" ');
    }
    if (modo === 'full') {
      div.innerHTML =
        '<span class="pcs-blob b1"></span><span class="pcs-blob b2"></span><span class="pcs-blob b3"></span>' +
        HUELLA.replace('<svg ', '<svg class="pcs-deco d1" ') + HUELLA.replace('<svg ', '<svg class="pcs-deco d2" ') +
        '<div class="pcs-centro">' +
          '<div class="pcs-logo"><span class="pcs-anillo"></span><span class="pcs-anillo a2"></span><span class="pcs-anillo a3"></span>' +
            '<div class="pcs-orbita">' + HUELLA + '</div><img alt="" src="' + LOGO + '"></div>' +
          '<h1 class="pcs-titulo"><span>Premier Can</span></h1>' +
          '<p class="pcs-sub">Clínica veterinaria</p>' +
          '<div class="pcs-huellas">' + huellas + '</div>' +
          '<div class="pcs-barra"><span></span></div>' +
          '<p class="pcs-frase"></p>' +
        '</div>';
      var frase = div.querySelector('.pcs-frase');
      var nombre = primerNombre();
      frase.textContent = textoInicial || (forzada && nombre ? '¡Hola, ' + nombre + '! Preparando tu espacio…' : FRASES[0]);
      var n = 0;
      div._rotar = setInterval(function () {
        frase.classList.add('cambiando');
        setTimeout(function () { n = (n + 1) % FRASES.length; frase.textContent = FRASES[n]; frase.classList.remove('cambiando'); }, 300);
      }, 1700);
    } else {
      div.innerHTML =
        '<div class="pcs-centro">' +
          '<div class="pcs-logo"><span class="pcs-anillo"></span><span class="pcs-anillo a2"></span><img alt="" src="' + LOGO + '"></div>' +
          '<div class="pcs-huellas">' + huellas + '</div>' +
        '</div>';
    }
    return div;
  }

  // ---------------- Montaje lo antes posible (apenas existe <body>) ----------------
  var splash = construir(completa ? 'full' : 'lite');
  var inicio = Date.now();
  var MIN_MS = reducido ? 0 : (completa ? 1500 : 0);

  function montar() {
    if (!document.body || splash.parentNode) return !!splash.parentNode;
    document.body.insertBefore(splash, document.body.firstChild);
    return true;
  }
  if (!montar()) {
    var obs = new MutationObserver(function () { if (montar()) obs.disconnect(); });
    obs.observe(html, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', function () { montar(); obs.disconnect(); });
  }

  // ---------------- Salida ----------------
  var ocultado = false;
  function ocultar() {
    if (ocultado) return;
    ocultado = true;
    var espera = Math.max(0, MIN_MS - (Date.now() - inicio));
    setTimeout(function () {
      splash.classList.add('pcs-listo');
      setTimeout(function () {
        splash.classList.add('pcs-out');
        html.classList.add('pc-pagina-lista');
        setTimeout(function () {
          clearInterval(splash._rotar);
          if (splash.parentNode) splash.parentNode.removeChild(splash);
        }, 750);
      }, completa ? 260 : 0);
    }, espera);
  }

  function listo() {
    var fuentes = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([fuentes, new Promise(function (r) { setTimeout(r, 2500); })]).then(function () {
      // Dos cuadros: deja que Tailwind (CDN) aplique sus estilos antes de mostrar
      requestAnimationFrame(function () { requestAnimationFrame(ocultar); });
    });
  }
  if (document.readyState === 'complete') listo();
  else window.addEventListener('load', listo);
  setTimeout(ocultar, 8000); // nunca se queda pegada

  // Volver con el botón "atrás" (página desde caché): sin pantalla de carga
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && splash.parentNode) { clearInterval(splash._rotar); splash.parentNode.removeChild(splash); }
  });

  // ---------------- API pública ----------------
  window.PCCarga = {
    mostrar: function (texto) {
      var s = construir('full', texto);
      s.style.opacity = '0';
      document.body.appendChild(s);
      requestAnimationFrame(function () { s.style.opacity = '1'; });
      escribir(CLAVE_COMPLETA, '1');
      return s;
    },
    siguienteCompleta: function () { escribir(CLAVE_COMPLETA, '1'); }
  };
})();
