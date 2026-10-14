import { wheelSegments } from './wheel.js';

const COLORS = ['#fb7185', '#b693ff', '#5ed4ed', '#63dbb1', '#ffd36d', '#ffab73', '#f18bc4', '#86a7ff', '#a4df75', '#ffda66'];
const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const svgNode = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
};
function paintWheel(rotor, segments) {
  const svg = svgNode('svg', { viewBox: '0 0 360 360', 'aria-hidden': 'true' });
  for (let i = 0; i < 10; i++) {
    const point = degrees => [180 + 168 * Math.sin(degrees * Math.PI / 180), 180 - 168 * Math.cos(degrees * Math.PI / 180)];
    const a = point(i * 36 - 18), b = point(i * 36 + 18);
    svg.append(svgNode('path', { d: `M180 180 L${a} A168 168 0 0 1 ${b} Z`, fill: COLORS[i], stroke: '#171d35', 'stroke-width': 2 }));
    const group = svgNode('g', { transform: `rotate(${i * 36} 180 180)` });
    const label = svgNode('text', { x: 180, y: 69, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'wheel-number' });
    label.textContent = segments[i];
    group.append(label);
    svg.append(group);
  }
  rotor.replaceChildren(svg);
}

export function createAllowanceWheel({ choose, changed }) {
  const element = node('details', 'allowance-wheel');
  const summary = node('summary', 'wheel-summary', '✦ Try the fortune wheel instead');
  const panel = node('div', 'wheel-panel');
  const eyebrow = node('div', 'wheel-eyebrow', 'YOUR ALLOWANCE · YOUR CHOICE');
  const heading = node('h3', 'wheel-heading', 'A little spin of luck');
  const description = node('p', 'wheel-description');
  const stage = node('div', 'wheel-stage');
  const ring = node('div', 'wheel-ring');
  const rotor = node('div', 'wheel-rotor');
  const pointer = node('div', 'wheel-pointer');
  pointer.setAttribute('aria-hidden', 'true');
  const hub = node('div', 'wheel-hub', '✦');
  hub.setAttribute('aria-hidden', 'true');
  ring.append(rotor, hub);
  stage.append(ring, pointer);
  const result = node('div', 'wheel-result', 'Keep it guaranteed, or give it a spin.');
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');
  const spin = node('button', 'wheel-spin', 'Spin instead');
  spin.type = 'button';
  const finePrint = node('p', 'wheel-fine-print', 'One spin per active day. Your result replaces today’s allowance—even if it is zero. Unused rewards expire; only staked days earn an allowance.');
  panel.append(eyebrow, heading, description, stage, result, spin, finePrint);
  element.append(summary, panel);
  let bettor = '', wallet = null, busy = false, disposed = false, animation;
  let painted = '', savedId = '', failure = '';
  let previousBettor = '';
  function update(nextWallet, nextBettor, locked = false) {
    wallet = nextWallet; bettor = nextBettor;
    if (bettor !== previousBettor) failure = '';
    previousBettor = bettor;
    const choice = wallet?.choice;
    element.hidden = !bettor || (choice?.mode !== 'wheel' && (wallet?.allowanceCredited || choice?.mode === 'normal'));
    if (busy) { spin.disabled = true; return; }
    const amount = wallet ? wallet.allowance - wallet.repayment : 20;
    const segments = choice?.mode === 'wheel' ? choice.segments : wheelSegments(amount);
    const signature = JSON.stringify(segments);
    if (signature !== painted) { paintWheel(rotor, segments); painted = signature; }
    description.textContent = `Keep ${amount} guaranteed, or spin for ${Math.min(...segments)}–${Math.max(...segments)}. Average: ${amount}. Zero chance: ${segments.filter(n => n === 0).length * 10}%.${wallet?.repayment ? ` Loan repayment of ${wallet.repayment} is kept separate.` : ''}`;
    spin.disabled = !bettor || locked || Boolean(choice);
    spin.hidden = choice?.mode === 'wheel';
    if (choice?.mode === 'wheel') {
      if (savedId !== choice.id) rotor.style.transform = `rotate(${(360 - choice.segment * 36) % 360}deg)`;
      savedId = choice.id;
      summary.textContent = `✦ Today’s wheel: ${choice.payout} golden football${choice.payout === 1 ? '' : 's'}`;
      result.textContent = choice.payout ? `${choice.payout} golden football${choice.payout === 1 ? '' : 's'} to bet with!` : 'Zero this time. Your next active day is a fresh start.';
    } else {
      savedId = ''; rotor.style.transform = '';
      summary.textContent = '✦ Try the fortune wheel instead';
      result.textContent = failure || 'Keep it guaranteed, or give it a spin.';
    }
  }
  async function reveal(choice) {
      element.classList.remove('wheel-revealed');
      paintWheel(rotor, choice.segments); painted = JSON.stringify(choice.segments);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const angle = (reducedMotion ? 0 : 6 * 360) + (360 - choice.segment * 36) % 360;
      element.classList.add('is-spinning');
      result.textContent = 'Round and round…';
      animation = rotor.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${angle}deg)` }], {
        duration: reducedMotion ? 350 : 5200, easing: 'cubic-bezier(.12,.78,.16,1)', fill: 'forwards',
      });
      await animation.finished;
      rotor.style.transform = `rotate(${angle}deg)`;
      animation.cancel();
      savedId = choice.id;
      element.classList.add('wheel-revealed');
  }
  spin.addEventListener('click', async () => {
    if (busy || !bettor || wallet?.choice) return;
    busy = true; failure = ''; spin.disabled = true;
    result.textContent = 'Saving your spin…';
    changed();
    try {
      const choice = await choose(bettor, 'wheel');
      if (disposed) return;
      await reveal(choice);
    } catch (error) {
      if (!disposed) failure = error.message?.replace(/^Firebase:\s*/, '') || 'Could not save your spin. Please try again.';
    } finally {
      busy = false; element.classList.remove('is-spinning');
      if (!disposed) changed();
    }
  });
  return { element, update, get busy() { return busy; }, dispose() { disposed = true; animation?.cancel(); } };
}
