/**
 * assets/js/layout.js
 * Detalles visuales compartidos por todas las páginas (complementa theme.css).
 * No toca la lógica de negocio de ninguna página:
 *   - Oculta el texto de los íconos hasta que carga su fuente (sin "dashboard", "pets"... sueltos).
 *   - Marca en la barra lateral la página actual (aria-current).
 *   - Agrega la tarjeta del usuario conectado encima de "Cerrar sesión".
 *   - Traduce el subtítulo del logo y agrega el encabezado de bienvenida al portal de clientes.
 */
(function () {
  const raiz = document.documentElement;

  // --- Fuente de íconos ---
  function iconosListos() { raiz.classList.add('iconos-listos'); }
  if (document.fonts && document.fonts.load) {
    // fonts.load() también "resuelve" si la fuente aún no está disponible
    // (devuelve una lista vacía), así que reintentamos hasta que llegue.
    // Si nunca llega, los íconos quedan invisibles: mejor eso que ver
    // pedazos de texto como "das" o "pe" en lugar del dibujo.
    const inicio = Date.now();
    const esperarFuente = () => {
      document.fonts.load('24px "Material Symbols Outlined"').then((cargadas) => {
        if (cargadas.length) iconosListos();
        else if (Date.now() - inicio < 20000) setTimeout(esperarFuente, 300);
      }, () => {});
    };
    esperarFuente();
  } else {
    iconosListos();
  }

  function leerJson(clave) {
    try { return JSON.parse(localStorage.getItem(clave) || 'null'); } catch (e) { return null; }
  }

  function iniciales(nombre) {
    return (nombre || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }

  function saludoSegunHora() {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  // Secciones nuevas del menú: se agregan aquí (en un solo lugar) en vez de
  // copiarlas en el menú de cada página. soloAdmin: solo Administrativo.
  const SECCIONES_EXTRA = [
    { href: 'inventario.html', icono: 'inventory_2', texto: 'Inventario' },
    { href: 'compras.html', icono: 'local_shipping', texto: 'Compras', soloAdmin: true },
    { href: 'caja.html', icono: 'point_of_sale', texto: 'Caja' },
    { href: 'auditoria.html', icono: 'manage_search', texto: 'Actividad', soloAdmin: true },
  ];
  function agregarSeccionesExtra(nav) {
    const lista = nav.querySelector('ul');
    const reportes = lista && lista.querySelector('a[href$="reportes.html"]');
    if (!lista || !reportes || lista.querySelector('a[href$="inventario.html"]')) return;
    const usuario = leerJson('pc_usuario') || {};
    let despuesDe = reportes.closest('li');
    SECCIONES_EXTRA.forEach((s) => {
      if (s.soloAdmin && !usuario.accesoConfig) return;
      const li = document.createElement('li');
      li.innerHTML = `<a class="${reportes.className.replace(/\b(bg-primary-container|text-on-primary-container|border-l-4|border-primary|rounded-r-full)\b/g, '')} flex items-center gap-sm px-4 py-3" href="${s.href}"><span class="material-symbols-outlined">${s.icono}</span><span class="font-label-md text-label-md">${s.texto}</span></a>`;
      despuesDe.after(li);
      despuesDe = li;
    });
  }

  function prepararSidebar(nav) {
    agregarSeccionesExtra(nav);
    // Página actual
    const actual = window.location.pathname.split('/').pop() || 'dashboard.html';
    nav.querySelectorAll('ul a[href]').forEach((a) => {
      const destino = a.getAttribute('href').split('/').pop().split('?')[0];
      // historia-clinica y registrar-consulta pertenecen a "Historias Clínicas"
      const esActual = destino === actual || (actual === 'registrar-consulta.html' && destino === 'historia-clinica.html');
      if (esActual) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    const subtitulo = nav.querySelector('p');
    if (subtitulo && /Veterinary Clinic/i.test(subtitulo.textContent)) subtitulo.textContent = 'Clínica veterinaria';

    // Nombre + subtítulo juntos: en pantallas bajas el logo pasa a una fila (theme.css)
    const cabecera = nav.firstElementChild;
    const tituloNav = cabecera && cabecera.querySelector('h1');
    if (tituloNav && subtitulo && !cabecera.querySelector('.pc-sidebar-marca')) {
      const marca = document.createElement('div');
      marca.className = 'pc-sidebar-marca';
      tituloNav.before(marca);
      marca.append(tituloNav, subtitulo);
    }

    // Tarjeta del usuario
    const usuario = leerJson('pc_usuario');
    const salir = nav.querySelector('#btnCerrarSesion');
    if (usuario && salir && !nav.querySelector('.pc-user-card')) {
      const tarjeta = document.createElement('div');
      tarjeta.className = 'pc-user-card';
      tarjeta.innerHTML = '<div class="pc-avatar"></div><div><div class="pc-user-name"></div><div class="pc-user-role"></div></div>';
      tarjeta.querySelector('.pc-avatar').textContent = iniciales(usuario.nombreCompleto);
      tarjeta.querySelector('.pc-user-name').textContent = usuario.nombreCompleto || 'Usuario';
      tarjeta.querySelector('.pc-user-role').textContent = `${saludoSegunHora()} · ${usuario.rol || ''}`;
      salir.parentElement.insertBefore(tarjeta, salir);
    }
  }

  function prepararEncabezados() {
    const usuario = leerJson('pc_usuario');
    document.querySelectorAll('header').forEach((header) => {
      // Lugar del avatar en el encabezado -> iniciales del usuario real
      header.querySelectorAll('img[src*="googleusercontent"], [data-avatar-usuario]').forEach((img) => {
        const avatar = document.createElement('span');
        avatar.className = 'pc-avatar-mini';
        avatar.textContent = iniciales(usuario && usuario.nombreCompleto);
        avatar.title = usuario ? `${usuario.nombreCompleto} · ${usuario.rol}` : '';
        img.replaceWith(avatar);
      });

      // Buscador decorativo de la plantilla -> busca pacientes de verdad
      header.querySelectorAll('input[placeholder^="Search"]').forEach((input) => {
        input.placeholder = 'Buscar paciente o dueño… (Enter)';
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !input.value.trim()) return;
          window.location.href = `pacientes.html?buscar=${encodeURIComponent(input.value.trim())}`;
        });
      });

      // Íconos sin función (ayuda / notificaciones) -> accesos útiles
      header.querySelectorAll('button').forEach((btn) => {
        const icono = btn.querySelector('.material-symbols-outlined');
        if (!icono || btn.id || btn.onclick) return;
        const nombre = icono.textContent.trim();
        if (nombre === 'notifications') {
          btn.title = 'Recordatorios';
          btn.addEventListener('click', () => { window.location.href = 'recordatorios.html'; });
        } else if (nombre === 'help') {
          btn.title = 'Citas de hoy';
          icono.textContent = 'calendar_today';
          btn.addEventListener('click', () => { window.location.href = 'citas.html'; });
        }
      });
    });
  }

  function prepararPortalCliente() {
    // Solo en "Mis mascotas": convierte el saludo en un banner.
    if (!/mis-mascotas\.html$/.test(window.location.pathname)) return;
    const titulo = document.querySelector('main > h1');
    if (!titulo) return;
    const hero = document.createElement('div');
    hero.className = 'pc-hero';
    titulo.before(hero);
    hero.appendChild(titulo);
    const sub = hero.nextElementSibling;
    if (sub && sub.tagName === 'P') {
      sub.classList.remove('mb-lg');
      hero.appendChild(sub);
    }
  }

  // --- Pantallas de acceso: panel de marca a la izquierda (visible en pantallas anchas) ---
  const HUELLA_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="41" rx="12" ry="10"/><ellipse cx="17" cy="28" rx="5" ry="6.5" transform="rotate(-20 17 28)"/><ellipse cx="26" cy="19" rx="5" ry="6.5" transform="rotate(-6 26 19)"/><ellipse cx="38" cy="19" rx="5" ry="6.5" transform="rotate(6 38 19)"/><ellipse cx="47" cy="28" rx="5" ry="6.5" transform="rotate(20 47 28)"/></svg>';

  function textosMarca() {
    const ruta = window.location.pathname;
    const esCliente = /\/cliente\//.test(ruta);
    if (/404/.test(ruta) || /no encontrada/i.test(document.title)) {
      return {
        chip: 'Página no encontrada',
        titulo: 'Esta ruta se <em>escapó</em> del parque.',
        texto: 'Volvamos a un lugar conocido: el inicio te espera con todo en orden.',
        items: [['home', 'Vuelve al inicio de sesión'], ['support_agent', 'O pregunta en recepción']],
      };
    }
    if (esCliente) {
      return {
        chip: 'Portal de clientes',
        titulo: 'Tu mascota, siempre en <em>buenas manos</em>.',
        texto: 'Todo lo de tu peludito en un solo lugar, desde tu celular o tu computadora.',
        items: [['event_available', 'Agenda citas en segundos'], ['vaccines', 'Recibe avisos de vacunas y controles'], ['loyalty', 'Promociones exclusivas para ti']],
      };
    }
    return {
      chip: 'Panel de la clínica',
      titulo: 'Cuidamos a quienes <em>más quieres</em>.',
      texto: 'Historias clínicas, citas, vacunas y recordatorios, organizados para que tu equipo se enfoque en lo importante.',
      items: [['description', 'Historias clínicas siempre al día'], ['calendar_month', 'Citas y recordatorios automáticos'], ['vaccines', 'Esquemas preventivos bajo control']],
    };
  }

  // Carpeta assets/ (sirve igual desde /, /pages/ y /cliente/)
  function baseAssets() {
    const icono = document.querySelector('link[rel="icon"]');
    return icono && icono.href ? icono.href.replace(/img\/[^/]+$/, '') : 'assets/';
  }

  // --- Galería de fotos detrás del login (efectos alternados + Ken Burns) ---
  const FOTOS = [
    ['perros-corriendo.jpg', 'Energía y alegría en cada paseo', '5%', '-3%'],
    ['cuidando-gato.jpg', 'Atención con cariño, siempre', '-4%', '2%'],
    ['beagle.jpg', 'Sonrisas que dan gusto ver', '3%', '4%'],
    ['gato-naranja.jpg', 'Mininos felices y sanos', '-5%', '-2%'],
    ['perro-playa.jpg', 'Más aventuras con buena salud', '4%', '-4%'],
    ['amigos.jpg', 'Amigos para siempre', '-3%', '3%'],
  ];
  const EFECTOS = ['circulo', 'diagonal', 'fundido', 'persiana'];
  const INTERVALO = 6500;

  function prepararGaleria(marca) {
    const fondo = document.querySelector('body.pc-acceso > .absolute.inset-0.z-0');
    if (!fondo || fondo.querySelector('.pc-galeria')) return;
    const carpeta = `${baseAssets()}img/fondos/`;
    const galeria = document.createElement('div');
    galeria.className = 'pc-galeria';
    const slides = FOTOS.map(([archivo, , x, y]) => {
      const s = document.createElement('div');
      s.className = 'pc-slide';
      s.style.setProperty('--kb-x', x);
      s.style.setProperty('--kb-y', y);
      s.dataset.src = carpeta + archivo;
      galeria.appendChild(s);
      return s;
    });
    fondo.appendChild(galeria);

    // Leyenda + puntitos de progreso (en el panel de marca, pantallas anchas)
    const leyenda = marca.querySelector('.pc-leyenda');
    const puntos = marca.querySelector('.pc-puntos');
    puntos.style.setProperty('--pc-intervalo', `${INTERVALO}ms`);
    const botones = FOTOS.map((f, n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.tabIndex = -1;
      b.title = f[1];
      b.addEventListener('click', () => irA(n));
      puntos.appendChild(b);
      return b;
    });

    const cargar = (s) => new Promise((ok) => {
      if (s.dataset.lista) return ok();
      const img = new Image();
      img.onload = img.onerror = () => { s.style.backgroundImage = `url("${s.dataset.src}")`; s.dataset.lista = '1'; ok(); };
      img.src = s.dataset.src;
    });

    let actual = -1;
    let efecto = 0;
    let timer = null;

    async function mostrar(n, tipo) {
      await cargar(slides[n]);
      slides.forEach((s) => s.classList.remove('saliendo'));
      if (actual >= 0 && actual !== n) {
        slides[actual].classList.remove('activa');
        slides[actual].classList.add('saliendo');
      }
      const s = slides[n];
      s.dataset.efecto = tipo;
      s.classList.remove('activa');
      void s.offsetWidth; // reinicia las animaciones
      s.classList.add('activa');
      actual = n;

      leyenda.classList.add('cambiando');
      setTimeout(() => { leyenda.lastChild.textContent = FOTOS[n][1]; leyenda.classList.remove('cambiando'); }, 350);
      botones.forEach((b, k) => { b.classList.remove('activo'); if (k === n) { void b.offsetWidth; b.classList.add('activo'); } });
      cargar(slides[(n + 1) % slides.length]); // precarga la siguiente
    }

    function programar() {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(() => irA((actual + 1) % slides.length), INTERVALO);
    }
    function irA(n) {
      if (n === actual) return;
      mostrar(n, EFECTOS[efecto++ % EFECTOS.length]).then(programar);
    }
    document.addEventListener('visibilitychange', programar);
    mostrar(0, 'fundido').then(programar);
  }

  // --- Tarjeta del login: inclinación 3D + brillo que sigue al mouse ---
  function prepararInclinacion(tarjeta) {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cuadro = null;
    tarjeta.addEventListener('mousemove', (e) => {
      const r = tarjeta.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => {
        tarjeta.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        tarjeta.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        tarjeta.style.transform = `perspective(1100px) rotateX(${((0.5 - py) * 5).toFixed(2)}deg) rotateY(${((px - 0.5) * 6).toFixed(2)}deg)`;
      });
    });
    tarjeta.addEventListener('mouseleave', () => {
      cancelAnimationFrame(cuadro);
      tarjeta.style.transform = '';
    });
  }

  function prepararAcceso() {
    const tarjeta = document.querySelector('.max-w-md.mt-36');
    if (!tarjeta || !document.querySelector('[data-mascota]')) return;
    document.body.classList.add('pc-acceso');
    if (document.querySelector('.pc-marca')) return;

    const logo = `${baseAssets()}img/Logo2.jpg`;
    const t = textosMarca();
    const marca = document.createElement('aside');
    marca.className = 'pc-marca';
    marca.setAttribute('aria-hidden', 'true');
    marca.innerHTML =
      `<div class="pc-marca-top"><img alt="" src="${logo}"><div><strong>Premier Can</strong><small>Clínica veterinaria</small></div></div>` +
      `<div class="pc-marca-centro"><span class="pc-marca-chip"><i></i>${t.chip}</span><h1>${t.titulo}</h1><p>${t.texto}</p>` +
      `<ul>${t.items.map(([ico, txt]) => `<li><span class="material-symbols-outlined">${ico}</span>${txt}</li>`).join('')}</ul></div>` +
      '<div class="pc-marca-abajo">' +
        '<div class="pc-galeria-pie"><span class="pc-leyenda"><span class="material-symbols-outlined" style="font-size:17px">photo_camera</span><span></span></span><div class="pc-puntos"></div></div>' +
        `<div class="pc-marca-pie"><span>© ${new Date().getFullYear()} Premier Can</span><span>Hecho con 💚 para los peluditos</span></div>` +
      '</div>';
    // Huellitas flotando (posición/retardo variados)
    [[12, 0, -20], [38, 5, 15], [64, 10, -10], [84, 2.5, 25], [24, 8, 30], [74, 13, -25]].forEach(([izq, retardo, giro]) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = HUELLA_SVG;
      const svg = tmp.firstChild;
      svg.classList.add('pc-marca-huella');
      svg.style.cssText = `left:${izq}%;bottom:-60px;animation-delay:${retardo}s;--r:${giro}deg`;
      marca.appendChild(svg);
    });
    document.body.appendChild(marca);
    prepararGaleria(marca);
    prepararInclinacion(tarjeta);
  }

  // ============================================================
  // Interruptor de tema claro / oscuro
  // ============================================================
  function crearSwitch() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pc-switch';
    b.setAttribute('role', 'switch');
    b.innerHTML = '<span class="pc-switch-perilla"></span>';
    return b;
  }

  // Cambio con una "ola" circular que nace donde hiciste clic
  function alternarTema(evento) {
    if (!window.PCTema) return;
    evento.stopPropagation();
    const nuevo = !window.PCTema.esOscuro();
    const x = evento.clientX || window.innerWidth - 40;
    const y = evento.clientY || 40;
    const radio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reducido) { window.PCTema.poner(nuevo); return; }
    const transicion = document.startViewTransition(() => window.PCTema.poner(nuevo));
    transicion.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radio}px at ${x}px ${y}px)`] },
        { duration: 750, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
  }

  function pintarEstadoTema() {
    const oscuro = window.PCTema.esOscuro();
    document.querySelectorAll('.pc-switch').forEach((s) => {
      s.setAttribute('aria-checked', String(oscuro));
      s.title = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    });
    document.querySelectorAll('.pc-tema-etiqueta').forEach((e) => { e.textContent = oscuro ? 'Modo oscuro' : 'Modo claro'; });
    document.querySelectorAll('.pc-tema-icono').forEach((e) => { e.textContent = oscuro ? 'dark_mode' : 'light_mode'; });
  }

  function prepararTema() {
    if (!window.PCTema || document.querySelector('.pc-switch')) return;
    const nav = document.getElementById('sidebarNav');
    const salir = document.getElementById('btnCerrarSesion');

    if (nav && salir) {
      // Panel del personal: fila "Modo claro/oscuro" encima de la tarjeta del usuario
      const fila = document.createElement('div');
      fila.className = 'pc-tema-fila';
      fila.innerHTML = '<span class="pc-tema-texto"><span class="material-symbols-outlined pc-tema-icono">light_mode</span><span class="pc-tema-etiqueta"></span></span>';
      fila.appendChild(crearSwitch());
      fila.addEventListener('click', alternarTema);
      (nav.querySelector('.pc-user-card') || salir).before(fila);
    } else if (salir && salir.closest('header')) {
      // Portal de clientes: interruptor en el encabezado
      const caja = document.createElement('div');
      caja.className = 'pc-tema-encabezado';
      const sw = crearSwitch();
      sw.addEventListener('click', alternarTema);
      caja.appendChild(sw);
      salir.before(caja);
    } else {
      // Pantallas de acceso: botón flotante arriba a la derecha
      const flotante = document.createElement('div');
      flotante.className = 'pc-tema-flotante';
      flotante.innerHTML = '<span class="pc-tema-etiqueta"></span>';
      flotante.appendChild(crearSwitch());
      flotante.addEventListener('click', alternarTema);
      document.body.appendChild(flotante);
    }
    pintarEstadoTema();
    window.addEventListener('pc:tema', pintarEstadoTema);
  }

  // ============================================================
  // Efectos: onda al hacer clic, luz que sigue al mouse, huellitas
  // ============================================================
  const CON_ONDA = 'button.bg-primary, a.bg-primary, .pc-atajo, #roleSelector button, .pc-switch';
  function prepararEfectos() {
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest(CON_ONDA);
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      const lado = Math.max(r.width, r.height) * 2.2;
      const onda = document.createElement('span');
      onda.className = 'pc-onda';
      onda.style.cssText = `width:${lado}px;height:${lado}px;left:${e.clientX - r.left - lado / 2}px;top:${e.clientY - r.top - lado / 2}px`;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.style.overflow = 'hidden';
      el.appendChild(onda);
      setTimeout(() => onda.remove(), 700);
    });

    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest('.pc-stat, .pc-atajo');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  // ============================================================
  // Confirmación con el diseño del sistema (en vez del confirm() del navegador)
  //   const ok = await PCConfirmar({ titulo, mensaje, textoSi, peligro: true });
  // Escape o clic afuera = cancelar. Enter = confirmar.
  // ============================================================
  window.PCConfirmar = function ({ titulo = '¿Estás seguro?', mensaje = '', textoSi = 'Sí, continuar', textoNo = 'No, volver', peligro = false, icono } = {}) {
    return new Promise((resolver) => {
      const capa = document.createElement('div');
      capa.className = 'pc-confirmar';
      capa.setAttribute('role', 'alertdialog');
      capa.setAttribute('aria-modal', 'true');
      capa.innerHTML = `
        <div class="pc-confirmar-caja">
          <span class="pc-confirmar-icono ${peligro ? 'peligro' : ''}"><span class="material-symbols-outlined">${icono || (peligro ? 'warning' : 'help')}</span></span>
          <h3></h3><p></p>
          <div class="pc-confirmar-botones">
            <button type="button" class="pc-confirmar-no"></button>
            <button type="button" class="pc-confirmar-si ${peligro ? 'peligro' : ''}"></button>
          </div>
        </div>`;
      capa.querySelector('h3').textContent = titulo;
      capa.querySelector('p').textContent = mensaje;
      capa.querySelector('.pc-confirmar-no').textContent = textoNo;
      capa.querySelector('.pc-confirmar-si').textContent = textoSi;
      const previo = document.activeElement;
      const cerrar = (valor) => {
        document.removeEventListener('keydown', teclas, true);
        capa.classList.add('saliendo');
        setTimeout(() => capa.remove(), 180);
        if (previo && previo.focus) previo.focus();
        resolver(valor);
      };
      const teclas = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cerrar(false); }
        if (e.key === 'Enter') { e.preventDefault(); cerrar(true); }
      };
      capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(false); });
      capa.querySelector('.pc-confirmar-no').addEventListener('click', () => cerrar(false));
      capa.querySelector('.pc-confirmar-si').addEventListener('click', () => cerrar(true));
      document.addEventListener('keydown', teclas, true);
      document.body.appendChild(capa);
      capa.querySelector(peligro ? '.pc-confirmar-no' : '.pc-confirmar-si').focus();
    });
  };

  // ============================================================
  // Gráfico de evolución del peso (SVG propio, sin librerías)
  //   PCGraficoPeso(elemento, [{ fecha: '2026-01-10', peso: 12.4 }, ...])
  // ============================================================
  window.PCGraficoPeso = function (cont, datos) {
    const puntos = (datos || [])
      .filter((d) => d && d.peso > 0 && d.fecha)
      .map((d) => ({ fecha: String(d.fecha).slice(0, 10), peso: Number(d.peso) }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!puntos.length) {
      cont.innerHTML = '<p class="pc-peso-vacio">Todavía no hay pesos registrados. Se agregan al registrar una consulta.</p>';
      return;
    }
    const W = 600; const H = 210; const M = { t: 26, r: 18, b: 34, l: 42 };
    const pesos = puntos.map((p) => p.peso);
    let min = Math.min(...pesos); let max = Math.max(...pesos);
    const holgura = Math.max(0.5, (max - min) * 0.25);
    min = Math.max(0, min - holgura); max += holgura;
    const x = (i) => (puntos.length === 1 ? (M.l + W - M.r) / 2 : M.l + (i * (W - M.l - M.r)) / (puntos.length - 1));
    const y = (v) => M.t + (1 - (v - min) / (max - min)) * (H - M.t - M.b);
    const linea = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.peso).toFixed(1)}`).join(' ');
    const area = `${linea} L${x(puntos.length - 1).toFixed(1)},${H - M.b} L${x(0).toFixed(1)},${H - M.b} Z`;
    const etiquetaFecha = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: 'UTC' });
    const cada = Math.ceil(puntos.length / 6);
    const guias = [0, 0.5, 1].map((t) => min + t * (max - min));
    const id = `g${Math.random().toString(36).slice(2, 8)}`;
    const ultimo = puntos[puntos.length - 1];
    const cambio = puntos.length > 1 ? ultimo.peso - puntos[puntos.length - 2].peso : 0;
    cont.innerHTML = `
      <div class="pc-peso-resumen">
        <span class="pc-peso-actual">${ultimo.peso.toLocaleString('es-PE', { maximumFractionDigits: 2 })} kg</span>
        ${puntos.length > 1 ? `<span class="pc-peso-cambio ${cambio > 0 ? 'sube' : cambio < 0 ? 'baja' : ''}">${cambio > 0 ? '▲' : cambio < 0 ? '▼' : '='} ${Math.abs(cambio).toLocaleString('es-PE', { maximumFractionDigits: 2 })} kg desde la consulta anterior</span>` : '<span class="pc-peso-cambio">Primer registro</span>'}
      </div>
      <svg class="pc-peso-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del peso">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        ${guias.map((g) => `<line x1="${M.l}" x2="${W - M.r}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="pc-peso-guia"/><text x="${M.l - 8}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end" class="pc-peso-eje">${g.toFixed(1)}</text>`).join('')}
        ${puntos.length > 1 ? `<path d="${area}" fill="url(#${id})"/><path d="${linea}" class="pc-peso-linea"/>` : ''}
        ${puntos.map((p, i) => `
          <g class="pc-peso-punto"><title>${etiquetaFecha(p.fecha)}: ${p.peso} kg</title>
            <circle cx="${x(i).toFixed(1)}" cy="${y(p.peso).toFixed(1)}" r="5.5"/>
            ${(i === puntos.length - 1 || puntos.length <= 6) ? `<text x="${x(i).toFixed(1)}" y="${(y(p.peso) - 11).toFixed(1)}" text-anchor="middle" class="pc-peso-valor">${p.peso}</text>` : ''}
            ${(i % cada === 0 || i === puntos.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="pc-peso-eje">${etiquetaFecha(p.fecha)}</text>` : ''}
          </g>`).join('')}
      </svg>`;
  };

  // ============================================================
  // Abrir un archivo protegido (exige sesión): se baja con el token y se
  // muestra en una pestaña nueva (abierta en el mismo clic para que no la bloqueen).
  //   PCAbrirArchivo('/api/adjuntos/5/descargar', 'pc_token')
  // ============================================================
  window.PCAbrirArchivo = async function (ruta, claveToken = 'pc_token') {
    const pestana = window.open('', '_blank');
    if (pestana) pestana.document.write('<p style="font-family:sans-serif;padding:24px;color:#5d7174">Abriendo archivo…</p>');
    try {
      const base = window.API_BASE_URL ? window.API_BASE_URL.replace(/\/api$/, '') : '';
      const resp = await fetch(base + ruta, { headers: { Authorization: `Bearer ${localStorage.getItem(claveToken) || ''}` } });
      if (!resp.ok) {
        let msg = 'No se pudo abrir el archivo.';
        try { msg = (await resp.json()).mensaje || msg; } catch (_) { /* sin cuerpo */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await resp.blob());
      if (pestana) pestana.location = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (pestana) pestana.close();
      alert(err.message);
    }
  };

  // Lluvia de huellitas de colores (p. ej. al iniciar sesión)
  window.PCEfectos = {
    huellitas(x, y, cantidad = 18) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const colores = ['#58d6a7', '#f2c14e', '#ff8a7a', '#7dd4e2', '#ffffff', '#3ddc97'];
      for (let i = 0; i < cantidad; i++) {
        const tmp = document.createElement('div');
        tmp.innerHTML = HUELLA_SVG;
        const p = tmp.firstChild;
        p.classList.add('pc-confeti');
        p.style.left = `${x - 11}px`;
        p.style.top = `${y - 11}px`;
        p.style.setProperty('--c', colores[i % colores.length]);
        document.body.appendChild(p);
        const ang = (Math.PI * 2 * i) / cantidad + Math.random() * 0.5;
        const dist = 90 + Math.random() * 130;
        const dx = Math.cos(ang) * dist;
        const dy = Math.sin(ang) * dist - 60;
        const giro = (Math.random() - 0.5) * 540;
        const escala = 0.6 + Math.random() * 0.8;
        p.animate([
          { transform: 'translate(0,0) scale(.2) rotate(0deg)', opacity: 1 },
          { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(${escala}) rotate(${giro * 0.6}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${dx}px, ${dy + 140}px) scale(${escala * 0.8}) rotate(${giro}deg)`, opacity: 0 },
        ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' })
          .onfinish = () => p.remove();
      }
    },
  };

  function iniciar() {
    const nav = document.getElementById('sidebarNav');
    if (nav) prepararSidebar(nav);
    if (nav) prepararEncabezados();
    prepararPortalCliente();
    prepararAcceso();
    prepararTema();
    prepararEfectos();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
