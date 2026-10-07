// utils/precios.js
// Reglas de precios y descuentos de Caja (una sola fuente de verdad).
//
// Cada ítem del cobro pertenece a un GRUPO, el mismo nombre que las categorías
// de Promociones ("Vacunas", "Consultas", "Baño y grooming"...). Una promoción
// con categoría descuenta solo los ítems de ese grupo; sin categoría (u "Otro"),
// descuenta todo el cobro.

// Categoría del inventario -> grupo de promociones
const GRUPO_INVENTARIO = {
  Vacuna: 'Vacunas',
  Antiparasitario: 'Desparasitación',
  Medicamento: 'Tienda',
  Insumo: 'Tienda',
  Alimento: 'Tienda',
};

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Regla de descuento de una promoción, en este orden:
 *  1) Descuento en caja configurado (DescuentoTipo + DescuentoValor).
 *  2) Precio regular vs. precio de promoción -> descuento fijo por la diferencia.
 *  3) Etiqueta con porcentaje ("-20%", "20 % dscto") -> porcentaje.
 * Devuelve { tipo: 'Porcentaje'|'Monto', valor } o null si no se puede aplicar sola.
 */
function reglaPromocion(p) {
  if (p.DescuentoTipo && Number(p.DescuentoValor) > 0) {
    return { tipo: p.DescuentoTipo, valor: Math.min(Number(p.DescuentoValor), p.DescuentoTipo === 'Porcentaje' ? 100 : Infinity) };
  }
  const reg = Number(p.PrecioRegular); const promo = Number(p.PrecioPromocion);
  if (p.PrecioRegular != null && p.PrecioPromocion != null && reg > promo) return { tipo: 'Monto', valor: redondear(reg - promo) };
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(p.Etiqueta || '');
  if (m) { const v = Number(m[1].replace(',', '.')); if (v > 0 && v <= 100) return { tipo: 'Porcentaje', valor: v }; }
  return null;
}

const aplicaATodo = (p) => !p.Categoria || p.Categoria === 'Otro';

/** Cuánto descuenta la promoción sobre estos ítems ({ grupo, subtotal }). */
function descuentoDePromocion(items, p) {
  const regla = reglaPromocion(p);
  if (!regla) return { descuento: 0, base: 0, regla: null };
  const base = redondear(items.filter((i) => aplicaATodo(p) || i.grupo === p.Categoria).reduce((s, i) => s + i.subtotal, 0));
  if (base <= 0) return { descuento: 0, base, regla };
  const descuento = regla.tipo === 'Porcentaje' ? redondear((base * regla.valor) / 100) : Math.min(redondear(regla.valor), base);
  return { descuento, base, regla };
}

/** Descuento manual de un monto: { tipo: 'Porcentaje'|'Monto', valor } sobre "base" (nunca más que la base). */
function descuentoManual(base, d) {
  if (!d) return 0;
  const v = Number(d.valor);
  if (!(v > 0)) return 0;
  return d.tipo === 'Porcentaje' ? redondear((base * Math.min(v, 100)) / 100) : Math.min(redondear(v), redondear(base));
}

/**
 * Reparte el descuento de una promoción entre los ítems que cubre, proporcional
 * a su subtotal; el último absorbe el redondeo para que la suma sea exacta.
 * Devuelve un arreglo paralelo a "items" (0 para los que no cubre).
 */
function repartirPromocion(items, cubre, total) {
  const reparto = items.map(() => 0);
  const idx = items.map((it, k) => (cubre(it) ? k : -1)).filter((k) => k >= 0);
  const base = idx.reduce((s, k) => s + items[k].subtotal, 0);
  if (!(total > 0) || !(base > 0)) return reparto;
  let resto = redondear(total);
  idx.forEach((k, n) => {
    const parte = n === idx.length - 1 ? resto : redondear((total * items[k].subtotal) / base);
    reparto[k] = parte; resto = redondear(resto - parte);
  });
  return reparto;
}

module.exports = { GRUPO_INVENTARIO, reglaPromocion, descuentoDePromocion, descuentoManual, repartirPromocion, redondear, aplicaATodo };
