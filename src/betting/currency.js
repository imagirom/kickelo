// src/betting/currency.js
// Golden-football amounts: number + shiny gold ball icon.
export const GF_ICON_SRC = 'assets/golden-football.svg';

export function footballs(amount) {
  const span = document.createElement('span');
  span.className = 'gf-amount';
  const n = Math.round(amount);
  span.setAttribute('aria-label', `${n} golden footballs`);
  span.textContent = String(n);
  const img = document.createElement('img');
  img.className = 'gf-icon';
  img.src = GF_ICON_SRC;
  img.alt = '';
  span.appendChild(img);
  return span;
}
