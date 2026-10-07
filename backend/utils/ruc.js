// utils/ruc.js
// RUC peruano (SUNAT): 11 dígitos, empieza con 10 (persona natural), 15, 17
// o 20 (empresa), y el último dígito es de control (módulo 11).
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

function rucValido(ruc) {
  const r = String(ruc || '').trim();
  if (!/^(10|15|17|20)\d{9}$/.test(r)) return false;
  const suma = PESOS.reduce((s, p, i) => s + p * Number(r[i]), 0);
  const control = (11 - (suma % 11)) % 10;
  return control === Number(r[10]);
}

module.exports = { rucValido };
