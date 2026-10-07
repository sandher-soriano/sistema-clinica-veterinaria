/**
 * assets/js/promo-ui.js
 * Utilidades de presentación de promociones, compartidas por:
 *   - pages/promociones.html      (panel: lista + vista previa en vivo del formulario)
 *   - cliente/promociones.html    (lista para clientes)
 *   - cliente/promocion.html      (detalle)
 * Así el administrador ve EXACTAMENTE la misma tarjeta que verá el cliente.
 */
(function () {
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

  // Emoji + degradado por categoría (se usa cuando la promoción no tiene imagen)
  const CATEGORIAS = {
    'Consultas': { emoji: '🩺', fondo: 'linear-gradient(135deg,#0d7a87,#00505a)' },
    'Vacunas': { emoji: '💉', fondo: 'linear-gradient(135deg,#3aa8c1,#0d5f86)' },
    'Desparasitación': { emoji: '🛡️', fondo: 'linear-gradient(135deg,#58b88a,#1f6f55)' },
    'Baño y grooming': { emoji: '🛁', fondo: 'linear-gradient(135deg,#7aa7ff,#5b5fd6)' },
    'Cirugía': { emoji: '🏥', fondo: 'linear-gradient(135deg,#8a8fb8,#434a7a)' },
    'Laboratorio': { emoji: '🔬', fondo: 'linear-gradient(135deg,#b58bd9,#6a3f99)' },
    'Tienda': { emoji: '🦴', fondo: 'linear-gradient(135deg,#ffb259,#e0662e)' },
    'Otro': { emoji: '🐾', fondo: 'linear-gradient(135deg,#ff8a7a,#d94f6b)' },
  };
  const CATEGORIA_DEFECTO = { emoji: '🐾', fondo: 'linear-gradient(135deg,#0d7a87,#003f46)' };

  const ESTADOS = {
    Vigente: { texto: 'Vigente', clase: 'promo-chip--vigente' },
    Programada: { texto: 'Próximamente', clase: 'promo-chip--programada' },
    Finalizada: { texto: 'Finalizada', clase: 'promo-chip--finalizada' },
    Inactiva: { texto: 'Pausada', clase: 'promo-chip--pausada' },
  };

  function escapar(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 'YYYY-MM-DD' -> { y, m, d } sin pasar por zonas horarias
  function partes(fecha) {
    const [y, m, d] = String(fecha || '').slice(0, 10).split('-').map(Number);
    return { y, m, d };
  }

  function fechaCorta(fecha) {
    const { m, d } = partes(fecha);
    return d ? `${d} ${MESES[m - 1]}` : '';
  }

  function fechaLarga(fecha) {
    const { y, m, d } = partes(fecha);
    return d ? `${d} ${MESES[m - 1]} ${y}` : '';
  }

  function rango(inicio, fin) {
    if (!inicio || !fin) return '';
    const a = partes(inicio);
    const b = partes(fin);
    if (inicio === fin) return fechaLarga(inicio);
    return a.y === b.y ? `${fechaCorta(inicio)} – ${fechaLarga(fin)}` : `${fechaLarga(inicio)} – ${fechaLarga(fin)}`;
  }

  // Días entre dos 'YYYY-MM-DD' (b - a)
  function diasEntre(a, b) {
    const pa = partes(a); const pb = partes(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }

  // "Hoy" en Perú (UTC-5), mismo criterio que el backend
  function hoyLima() {
    const ahora = new Date(Date.now() - 5 * 3600 * 1000);
    return ahora.toISOString().slice(0, 10);
  }

  function estadoDe(promo) {
    if (promo.Estado) return promo.Estado;
    if (promo.Activo === false) return 'Inactiva';
    const hoy = hoyLima();
    if (promo.FechaInicio && hoy < promo.FechaInicio) return 'Programada';
    if (promo.FechaFin && hoy > promo.FechaFin) return 'Finalizada';
    return 'Vigente';
  }

  function textoTiempo(promo) {
    const hoy = hoyLima();
    const estado = estadoDe(promo);
    if (estado === 'Programada') {
      const d = diasEntre(hoy, promo.FechaInicio);
      return d === 1 ? 'Empieza mañana' : `Empieza en ${d} días`;
    }
    if (estado === 'Vigente') {
      const d = diasEntre(hoy, promo.FechaFin);
      if (d <= 0) return '¡Último día!';
      if (d === 1) return 'Termina mañana';
      return `Quedan ${d} días`;
    }
    if (estado === 'Finalizada') return `Terminó el ${fechaLarga(promo.FechaFin)}`;
    return 'Pausada por la clínica';
  }

  // % del periodo que ya pasó (para la barrita de progreso)
  function avance(promo) {
    const total = diasEntre(promo.FechaInicio, promo.FechaFin) + 1;
    const pasados = diasEntre(promo.FechaInicio, hoyLima()) + 1;
    return Math.max(0, Math.min(100, Math.round((pasados / total) * 100)));
  }

  function precio(valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    if (!Number.isFinite(n)) return '';
    return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  }

  function descuento(promo) {
    const r = Number(promo.PrecioRegular); const p = Number(promo.PrecioPromocion);
    if (!r || !Number.isFinite(p) || p >= r || promo.PrecioPromocion === null || promo.PrecioPromocion === '') return null;
    return Math.round((1 - p / r) * 100);
  }

  function urlImagen(promo) {
    if (promo._previewUrl) return promo._previewUrl; // vista previa local del formulario
    if (!promo.ImagenURL) return null;
    return `${window.BACKEND_ORIGIN ?? ''}${promo.ImagenURL}`;
  }

  /** Bloque visual de portada: imagen o degradado con emoji de la categoría. */
  function portada(promo, { grande = false } = {}) {
    const cat = CATEGORIAS[promo.Categoria] || CATEGORIA_DEFECTO;
    const img = urlImagen(promo);
    const etiqueta = promo.Etiqueta || (descuento(promo) ? `-${descuento(promo)}%` : '');
    return `
      <div class="promo-portada${grande ? ' promo-portada--grande' : ''}" style="background:${cat.fondo}">
        ${img
          ? `<img src="${escapar(img)}" alt="" loading="lazy">`
          : `<span class="promo-portada__emoji" aria-hidden="true">${cat.emoji}</span>`}
        ${etiqueta ? `<span class="promo-etiqueta">${escapar(etiqueta)}</span>` : ''}
      </div>`;
  }

  function bloquePrecios(promo) {
    const promoTxt = precio(promo.PrecioPromocion);
    const regularTxt = precio(promo.PrecioRegular);
    if (!promoTxt && !regularTxt) return '';
    return `
      <div class="promo-precios">
        ${promoTxt ? `<span class="promo-precio">${promoTxt}</span>` : ''}
        ${regularTxt && promoTxt ? `<span class="promo-precio-antes">${regularTxt}</span>` : ''}
        ${regularTxt && !promoTxt ? `<span class="promo-precio">${regularTxt}</span>` : ''}
      </div>`;
  }

  /** Tarjeta tal como la ve el cliente (lista del portal y vista previa del admin). */
  function tarjetaCliente(promo, { href = null } = {}) {
    const estado = ESTADOS[estadoDe(promo)] || ESTADOS.Vigente;
    const etiquetaHtml = href ? 'a' : 'div';
    return `
      <${etiquetaHtml} class="promo-card" ${href ? `href="${escapar(href)}"` : ''}>
        ${portada(promo)}
        <div class="promo-card__cuerpo">
          <div class="promo-card__meta">
            <span class="promo-chip ${estado.clase}">${estado.texto}</span>
            ${promo.Categoria ? `<span class="promo-categoria">${escapar(promo.Categoria)}</span>` : ''}
          </div>
          <h3 class="promo-card__titulo">${escapar(promo.Titulo || 'Nombre de la promoción')}</h3>
          <p class="promo-card__desc">${escapar(promo.Descripcion || 'Aquí aparecerá la descripción de la promoción.')}</p>
          <div class="promo-card__pie">
            ${bloquePrecios(promo)}
            <span class="promo-tiempo"><span class="material-symbols-outlined">schedule</span>${escapar(textoTiempo(promo))}</span>
          </div>
        </div>
      </${etiquetaHtml}>`;
  }

  window.PromoUI = {
    escapar, fechaCorta, fechaLarga, rango, diasEntre, hoyLima, estadoDe, textoTiempo, avance,
    precio, descuento, urlImagen, portada, bloquePrecios, tarjetaCliente, ESTADOS, CATEGORIAS,
  };
})();
