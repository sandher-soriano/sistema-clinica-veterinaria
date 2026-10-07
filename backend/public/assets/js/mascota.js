/**
 * assets/js/mascota.js
 * Mascota interactiva de las pantallas de acceso (Max el perro / Luna la gata).
 *
 * Uso: pon <div data-mascota></div> como primer hijo de la tarjeta de login
 * (opcional: data-especie="gato" para empezar con la gata, data-frase="..."
 * para cambiar el saludo) e incluye este
 * archivo + assets/css/mascota.css. Se conecta sola a la página:
 *   - Campos de texto/correo  -> sigue con la mirada lo que escribes.
 *   - Campos de contraseña    -> se tapa los ojos con las patitas.
 *   - Contraseña visible (👁) -> espía por un huequito.
 *   - Mensaje de error visible -> se pone triste y niega con la cabeza.
 *   - Mensaje de éxito visible -> salta feliz y saca la lengua.
 *   - Clic sobre la mascota   -> cambia entre perro y gato (se recuerda).
 * También expone window.Mascota.{feliz, triste, decir} por si una página
 * quiere reaccionar a algo a mano.
 */
(function () {
  const CLAVE_ESPECIE = 'pc_mascota_especie';
  const NOMBRES = { perro: 'Max', gato: 'Luna' };

  const FRASES = {
    saludo: {
      perro: ['¡Guau! Soy Max 🐶', '¡Hola! ¿Vienes a ver a tu peludo?', '¡Qué gusto verte! 🐾'],
      gato: ['Miau… soy Luna 🐱', 'Hola, humano 😼', 'Prrr… bienvenido 🐾'],
    },
    cubrir: ['🙈 ¡No estoy mirando!', 'Tranquilo, no veo nada 🙈', 'Tu secreto está a salvo 🤐'],
    espiar: ['👀 Solo un poquito…', '¡Ups! Se ve todo 👀', 'No le diré a nadie 😇'],
    triste: ['Mmm… algo no cuadra 🥺', 'Inténtalo otra vez, tú puedes 🐾', '¿Revisas los datos? 🧐'],
    feliz: ['¡Listo! 🎉', '¡Genial! 🐾', '¡Perfecto! 💚'],
    cambio: {
      perro: ['¡Guau! Ahora me toca a mí, Max 🐶'],
      gato: ['Miau, ahora atiendo yo: Luna 🐱'],
    },
  };

  const azar = (lista) => lista[Math.floor(Math.random() * lista.length)];

  function leerEspecieGuardada() {
    try { return localStorage.getItem(CLAVE_ESPECIE); } catch (e) { return null; }
  }
  function guardarEspecie(especie) {
    try { localStorage.setItem(CLAVE_ESPECIE, especie); } catch (e) { /* sin almacenamiento */ }
  }

  let contador = 0;
  function crearSvg() {
    const clip = `m-clip-${++contador}`;
    return `
<svg class="mascota-svg" viewBox="0 0 200 180" aria-hidden="true" focusable="false">
  <defs><clipPath id="${clip}"><rect x="-20" y="-20" width="240" height="172"/></clipPath></defs>

  <!-- Cola (detrás de todo) -->
  <g class="m-tail">
    <path class="solo-perro" d="M150 146 C 172 140, 186 118, 181 94" fill="none" stroke="var(--m-fur-dark)" stroke-width="12" stroke-linecap="round"/>
    <path class="solo-gato" d="M150 148 C 190 142, 196 98, 174 82 C 162 74, 168 62, 180 66" fill="none" stroke="var(--m-fur-dark)" stroke-width="10" stroke-linecap="round"/>
  </g>

  <g class="m-head">
    <!-- Orejas de gata (detrás de la cabeza) -->
    <g class="solo-gato">
      <g class="m-ear-l"><path class="m-fur" d="M44 72 L50 16 L94 44 Z"/><path d="M53 60 L56 30 L82 46 Z" fill="#f7b6c2"/></g>
      <g class="m-ear-r"><path class="m-fur" d="M156 72 L150 16 L106 44 Z"/><path d="M147 60 L144 30 L118 46 Z" fill="#f7b6c2"/></g>
    </g>

    <ellipse class="m-fur" cx="100" cy="94" rx="62" ry="55"/>

    <!-- Detalles del pelaje -->
    <path class="m-light solo-perro" d="M100 40 C 91 60, 92 80, 100 98 C 108 80, 109 60, 100 40 Z" opacity=".9"/>
    <g class="solo-gato" stroke="var(--m-fur-dark)" stroke-width="4" stroke-linecap="round">
      <path d="M100 42 v15"/><path d="M87 45 l3 11"/><path d="M113 45 l-3 11"/>
    </g>

    <!-- Hocico -->
    <ellipse class="m-light solo-perro" cx="100" cy="121" rx="32" ry="23"/>
    <g class="solo-gato"><circle class="m-light" cx="89" cy="121" r="15"/><circle class="m-light" cx="111" cy="121" r="15"/></g>

    <!-- Cachetes -->
    <circle cx="62" cy="114" r="8" fill="#f49aa8" opacity=".45"/>
    <circle cx="138" cy="114" r="8" fill="#f49aa8" opacity=".45"/>

    <!-- Ojos -->
    <g class="m-eye m-eye-l"><g class="m-eye-inner">
      <ellipse class="m-eye-base" cx="76" cy="90" rx="9.5" ry="10.5"/>
      <ellipse class="m-pupil" cx="76" cy="90" rx="2.6" ry="7.5"/>
      <circle cx="79.5" cy="86" r="3" fill="#fff"/>
    </g></g>
    <g class="m-eye m-eye-r"><g class="m-eye-inner">
      <ellipse class="m-eye-base" cx="124" cy="90" rx="9.5" ry="10.5"/>
      <ellipse class="m-pupil" cx="124" cy="90" rx="2.6" ry="7.5"/>
      <circle cx="127.5" cy="86" r="3" fill="#fff"/>
    </g></g>
    <path class="m-stroke m-eye-happy" d="M67 93 q9 -11 18 0"/>
    <path class="m-stroke m-eye-happy" d="M115 93 q9 -11 18 0"/>
    <path class="m-stroke m-brow m-brow-l" d="M67 73 L85 73"/>
    <path class="m-stroke m-brow m-brow-r" d="M115 73 L133 73"/>

    <!-- Nariz y boca -->
    <g class="solo-perro">
      <path class="m-nose" d="M89 108 q11 -7 22 0 q-2 11 -11 13 q-9 -2 -11 -13 Z"/>
      <ellipse cx="96" cy="109" rx="3.2" ry="1.7" fill="#fff" opacity=".55"/>
    </g>
    <path class="m-nose solo-gato" d="M94 111 L106 111 L100 118 Z"/>
    <path class="m-tongue" d="M93 127 q7 15 14 0 Z" fill="#f07b8f"/>
    <path class="m-stroke m-mouth-normal" d="M100 120 v5 M100 125 q-7 7 -14 1 M100 125 q7 7 14 1"/>
    <path class="m-stroke m-mouth-sad" d="M88 133 q12 -9 24 0"/>

    <!-- Bigotes de gata -->
    <g class="solo-gato" stroke="#8a5a35" stroke-width="1.5" stroke-linecap="round">
      <path d="M78 121 L50 115"/><path d="M78 126 L48 127"/><path d="M78 131 L52 139"/>
      <path d="M122 121 L150 115"/><path d="M122 126 L152 127"/><path d="M122 131 L148 139"/>
    </g>

    <!-- Orejas de perro (caídas, encima de la cabeza) -->
    <g class="solo-perro">
      <g class="m-ear-l"><ellipse class="m-ear" cx="46" cy="80" rx="17" ry="36" transform="rotate(18 46 80)"/></g>
      <g class="m-ear-r"><ellipse class="m-ear" cx="154" cy="80" rx="17" ry="36" transform="rotate(-18 154 80)"/></g>
    </g>

    <!-- Collar de la clínica con placa -->
    <path d="M58 139 q42 22 84 0" fill="none" stroke="#00606a" stroke-width="9" stroke-linecap="round"/>
    <circle cx="100" cy="157" r="7.5" fill="#f2c14e" stroke="#c99a2a" stroke-width="1.5"/>
    <g fill="#c99a2a"><circle cx="100" cy="159" r="2.2"/><circle cx="97" cy="155" r="1.1"/><circle cx="100" cy="154" r="1.1"/><circle cx="103" cy="155" r="1.1"/></g>
  </g>

  <!-- Brazos: recortados en el borde de la tarjeta, así parece que salen desde atrás -->
  <g clip-path="url(#${clip})">
    <g class="m-paw m-paw-l"><rect class="m-fur" x="55" y="158" width="34" height="90" rx="17"/></g>
    <g class="m-paw m-paw-r"><rect class="m-fur" x="111" y="158" width="34" height="90" rx="17"/></g>
  </g>

  <!-- Patitas apoyadas sobre el borde -->
  <g class="m-paw m-paw-l">
    <ellipse class="m-paw-shape" cx="72" cy="158" rx="21" ry="15"/>
    <path class="m-toe" d="M63 147 v6 M72 145 v7 M81 147 v6"/>
  </g>
  <g class="m-paw m-paw-r">
    <ellipse class="m-paw-shape" cx="128" cy="158" rx="21" ry="15"/>
    <path class="m-toe" d="M119 147 v6 M128 145 v7 M137 147 v6"/>
  </g>
</svg>
<div class="mascota-burbuja" role="status" aria-live="polite"></div>`;
  }

  function crearMascota(contenedor) {
    let especie = leerEspecieGuardada() || contenedor.dataset.especie || 'perro';
    contenedor.classList.add('mascota-wrap', `m-${especie}`);
    contenedor.innerHTML = crearSvg();
    contenedor.title = 'Haz clic para cambiar de mascota';

    const svg = contenedor.querySelector('svg');
    const burbuja = contenedor.querySelector('.mascota-burbuja');
    let timerBurbuja = null;
    let timerEstado = null;
    let campoActivo = null;

    function decir(texto, ms = 2600) {
      burbuja.textContent = texto;
      burbuja.classList.add('visible');
      clearTimeout(timerBurbuja);
      timerBurbuja = setTimeout(() => burbuja.classList.remove('visible'), ms);
    }

    function mirar(x, y) {
      svg.style.setProperty('--lx', `${x.toFixed(1)}px`);
      svg.style.setProperty('--ly', `${y.toFixed(1)}px`);
    }

    function estadoTemporal(clase, ms) {
      contenedor.classList.remove('is-feliz', 'is-triste');
      void contenedor.offsetWidth; // reinicia la animación si se repite
      contenedor.classList.add(clase);
      clearTimeout(timerEstado);
      timerEstado = setTimeout(() => contenedor.classList.remove(clase), ms);
    }

    const api = {
      feliz(texto) { estadoTemporal('is-feliz', 1800); decir(texto || azar(FRASES.feliz)); },
      triste(texto) { estadoTemporal('is-triste', 2200); decir(texto || azar(FRASES.triste)); },
      decir,
    };

    // --- Mirada: sigue el cursor cuando no estás escribiendo ---
    document.addEventListener('mousemove', (e) => {
      if (campoActivo) return;
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.5);
      const dist = Math.hypot(dx, dy) || 1;
      const fuerza = Math.min(dist / 250, 1) * 4.5;
      mirar((dx / dist) * fuerza, (dy / dist) * fuerza);
    });

    // --- Campos de texto: la mirada avanza con lo que escribes ---
    function seguirTexto(input) {
      const largo = (input.value || '').length;
      const avance = Math.min(largo / 26, 1);
      mirar(-5 + avance * 10, 4.5);
    }

    const esPassword = (input) => input.dataset.mascotaPassword === '1';

    function actualizarCubierta() {
      const activo = campoActivo && esPassword(campoActivo);
      contenedor.classList.toggle('is-cubriendo', !!activo);
      contenedor.classList.toggle('is-espiando', !!activo && campoActivo.type === 'text');
    }

    function conectarCampo(input) {
      if (input.dataset.mascotaConectado) return;
      input.dataset.mascotaConectado = '1';
      if (input.type === 'password') input.dataset.mascotaPassword = '1';

      input.addEventListener('focus', () => {
        campoActivo = input;
        if (esPassword(input)) {
          mirar(0, 0);
          if (!contenedor.classList.contains('is-cubriendo')) decir(azar(FRASES.cubrir));
        } else {
          seguirTexto(input);
        }
        actualizarCubierta();
      });
      input.addEventListener('input', () => { if (!esPassword(input)) seguirTexto(input); });
      input.addEventListener('blur', () => {
        // Pequeña espera: si el foco salta a otro campo de contraseña,
        // la mascota no destapa los ojos por un instante.
        setTimeout(() => {
          if (campoActivo === input && document.activeElement !== input) {
            campoActivo = null;
            mirar(0, 0);
            actualizarCubierta();
          }
        }, 60);
      });

      // El botón del "ojito" cambia type=password <-> text: la mascota espía.
      if (esPassword(input)) {
        new MutationObserver(() => {
          if (campoActivo !== input && document.activeElement !== input) return;
          campoActivo = input;
          actualizarCubierta();
          if (input.type === 'text') decir(azar(FRASES.espiar));
        }).observe(input, { attributes: true, attributeFilter: ['type'] });
      }
    }

    function conectarTodo() {
      document.querySelectorAll('input[type="password"], input[type="text"], input[type="email"]').forEach(conectarCampo);
    }
    conectarTodo();

    // Los botones de "ver contraseña" roban el foco: lo devolvemos al campo.
    document.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('button[type="button"]');
      if (btn && btn.parentElement && btn.parentElement.querySelector('input[data-mascota-password="1"]')) {
        e.preventDefault();
      }
    });

    // --- Reacciones a mensajes de error / éxito de la página ---
    const EXITO = /actualizad|correctamente|ya puedes|enviad|revisa tu correo|listo/i;
    function revisarMensaje(el) {
      const visible = !el.classList.contains('hidden') && el.textContent.trim() !== '';
      if (!visible || el.dataset.mascotaVisto === el.textContent) return;
      el.dataset.mascotaVisto = el.textContent;
      const esBloqueExito = /ok|exito|resultado/i.test(el.id);
      if (esBloqueExito || EXITO.test(el.textContent)) api.feliz();
      else if (/error/i.test(el.id)) api.triste();
    }
    const vigilados = document.querySelectorAll('[id*="rror"], [id*="Ok"], [id*="exito"], [id*="resultado"]');
    const obs = new MutationObserver((cambios) => {
      cambios.forEach((c) => {
        const el = c.target.nodeType === 1 ? c.target : c.target.parentElement;
        const objetivo = el && el.closest('[id*="rror"], [id*="Ok"], [id*="exito"], [id*="resultado"]');
        if (objetivo) {
          if (!objetivo.classList.contains('hidden')) revisarMensaje(objetivo);
          else delete objetivo.dataset.mascotaVisto;
        }
      });
    });
    vigilados.forEach((el) => obs.observe(el, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true }));

    // --- Clic: cambia de especie ---
    contenedor.addEventListener('click', () => {
      especie = especie === 'perro' ? 'gato' : 'perro';
      guardarEspecie(especie);
      contenedor.classList.add('is-cambiando');
      setTimeout(() => {
        contenedor.classList.remove('m-perro', 'm-gato');
        contenedor.classList.add(`m-${especie}`);
      }, 250);
      setTimeout(() => contenedor.classList.remove('is-cambiando'), 520);
      decir(azar(FRASES.cambio[especie]));
    });

    // Saludo inicial
    setTimeout(() => decir(contenedor.dataset.frase || azar(FRASES.saludo[especie]), 3000), 600);

    return api;
  }

  function iniciar() {
    const contenedor = document.querySelector('[data-mascota]');
    if (!contenedor) return;
    window.Mascota = crearMascota(contenedor);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
