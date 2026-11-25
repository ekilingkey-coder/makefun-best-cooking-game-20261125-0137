// render.js — every DOM read and write. The model knows nothing about elements; this file does.

import { INGREDIENTS, RECIPES, TOOLS, TUNING } from './data.js';
import { plateRecipe } from './state.js';

const $ = (id) => document.getElementById(id);
const ingredientById = new Map(INGREDIENTS.map((i) => [i.id, i]));

/** Builds the counter bins, the recipe card and the tool zones once, at boot. */
export function buildStaticUi({ onBin, onTool, onServe, onTrash, onChop }) {
  const grid = $('counter-grid');
  grid.innerHTML = '';
  for (const ing of INGREDIENTS) {
    const button = document.createElement('button');
    button.className = 'bin';
    button.dataset.ingredient = ing.id;
    button.innerHTML = `
      <span class="bin-swatch" style="background:${ing.color}"></span>
      <span><span class="bin-name">${ing.name}</span><br><span class="bin-note">${ing.note}</span></span>
      <span class="bin-key">${ing.key}</span>`;
    button.addEventListener('click', () => onBin(ing.id));
    grid.appendChild(button);
  }

  const list = $('recipe-list');
  list.innerHTML = '';
  for (const recipe of RECIPES) {
    const row = document.createElement('li');
    row.className = 'recipe-row';
    row.dataset.recipe = recipe.id;
    const swatches = recipe.build.map(([id]) => {
      const ing = ingredientById.get(id);
      return `<span class="swatch" title="${ing.name}" style="background:${ing.color}"></span>`;
    }).join('');
    row.innerHTML = `<span class="recipe-swatches">${swatches}</span>
      <span class="rname">${recipe.name}</span><span class="rmethod">${recipe.method}</span>`;
    list.appendChild(row);
  }

  const zones = $('cooking-zones');
  zones.innerHTML = '';
  const chop = $('chop-zone');
  chop.onclick = onChop;

  for (const tool of TOOLS) {
    if (tool.kind !== 'stove') continue;
    const button = document.createElement('button');
    button.className = 'tool-zone';
    button.id = `${tool.id}-zone`;
    button.dataset.tool = tool.id;
    button.innerHTML = `
      <span class="tool-glyph">${tool.glyph}</span>
      <span class="tool-name">${tool.name}</span>
      <span class="tool-sub">${tool.sub}</span>
      <span class="tool-progress"><i></i></span>`;
    button.addEventListener('click', () => onTool(tool.id));
    zones.appendChild(button);
  }
}

/** Repaints the whole board from the model each frame. Cheap enough at 60fps. */
export function render(state, ui) {
  const { shift, now, heldName } = state;

  $('score-value').textContent = String(shift.score);
  $('tips-value').textContent = `$${shift.tips}`;
  $('streak-value').textContent = `⚡${shift.streak}`;

  const remain = Math.max(0, shift.endsAt - now);
  const total = TUNING.shiftSeconds * 1000;
  const frac = Math.min(1, remain / total);
  $('shift-fill').style.width = `${(frac * 100).toFixed(1)}%`;
  const secs = Math.ceil(remain / 1000);
  const rushText = shift.rush ? ' · RUSH' : '';
  $('shift-label').textContent = `SHIFT · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${rushText}`;
  $('rush-banner').hidden = !shift.rush;

  renderTickets(shift);
  renderPlate(shift);
  renderTools(shift, now);
  renderCounter(ui);
  renderActiveOrder(shift);
  renderHeld(shift, heldName);
  renderStars(shift);

  const canServe = ui.canServe;
  $('serve-button').disabled = !canServe;
  $('trash-button').disabled = shift.plate.length === 0;
}

function renderTickets(shift) {
  const list = $('ticket-list');
  const seen = new Set();
  for (const ticket of shift.tickets) {
    seen.add(ticket.id);
    let el = list.querySelector(`[data-ticket="${ticket.id}"]`);
    if (el === null) {
      el = document.createElement('li');
      el.className = 'ticket';
      el.dataset.ticket = ticket.id;
      const chips = ticket.recipe.build.map(([id, st]) => {
        const ing = ingredientById.get(id);
        const want = st === 'raw' ? ing.state : st;
        return `<span class="recipe-chip" data-chip="${id}:${want}">${ing.name}${st === 'cooked' ? ' ✦' : ''}</span>`;
      }).join('');
      el.innerHTML = `
        <div class="ticket-head"><span class="ticket-name">${ticket.recipe.name}</span>
        <span class="ticket-payout">$${ticket.recipe.base}</span></div>
        <div class="ticket-recipe">${chips}</div>
        <div class="ticket-timer"><i style="width:100%"></i></div>`;
      list.appendChild(el);
    }
    const frac = ticket.remainingMs / ticket.totalMs;
    const bar = el.querySelector('.ticket-timer');
    bar.classList.toggle('low', frac <= 0.5 && frac > 0.25);
    bar.classList.toggle('crit', frac <= 0.25);
    bar.firstElementChild.style.width = `${Math.max(0, frac * 100).toFixed(1)}%`;
    el.classList.toggle('is-rush', ticket.rush);
  }
  for (const el of [...list.children]) {
    if (!seen.has(Number(el.dataset.ticket))) el.remove();
  }
}

function renderPlate(shift) {
  const food = $('plate-food');
  food.innerHTML = '';
  const hasFood = shift.plate.length > 0;
  $('plate').classList.toggle('has-food', hasFood);
  // Bigger pieces when the plate is sparse, so a one-piece plate reads as a real dish.
  const sizeClass = shift.plate.length <= 2 ? 'size-3' : shift.plate.length <= 4 ? 'size-2' : 'size-1';
  for (const [id, state] of shift.plate) {
    const ing = ingredientById.get(id);
    const piece = document.createElement('span');
    piece.className = `food-piece ${sizeClass} ${state === 'burnt' ? 'burnt' : state === 'raw' ? 'raw' : ''}`;
    piece.style.background = ing.color;
    piece.title = `${ing.name} (${state})`;
    food.appendChild(piece);
  }
}

function renderTools(shift, now) {
  for (const tool of shift.tools) {
    const el = tool.kind === 'board' ? $('chop-zone') : $(`${tool.id}-zone`);
    if (el === null) continue;
    const bar = el.querySelector('.tool-progress > i');
    let width = 0;
    let cls = '';
    if (tool.item !== null && !tool.done) {
      const span = tool.readyAt - (tool.readyAt - (tool.busyUntil - tool.durationMs));
      const start = tool.readyAt - tool.durationMs;
      width = Math.min(100, ((now - start) / Math.max(1, tool.readyAt - start)) * 100);
      cls = 'is-busy';
    } else if (tool.done) {
      width = 100;
      cls = tool.item && tool.item[1] === 'burnt' ? 'is-busy' : 'is-ready';
    }
    el.classList.toggle('is-busy', cls === 'is-busy');
    el.classList.toggle('is-ready', cls === 'is-ready');
    el.classList.toggle('is-done', false);
    if (bar !== null) bar.style.width = `${width.toFixed(1)}%`;

    const sub = el.querySelector('.tool-sub');
    if (sub !== undefined) {
      if (tool.item !== null && tool.done) {
        const ing = ingredientById.get(tool.item[0]);
        sub.textContent = tool.item[1] === 'burnt' ? `${ing.name} burnt!` : `${ing.name} ready — S`;
      } else if (tool.item !== null) {
        sub.textContent = `${tool.verb}…`;
      } else {
        sub.textContent = tool.kind === 'board' ? 'press C to chop' : tool.sub;
      }
    }
  }
}

function renderCounter(ui) {
  for (const bin of document.querySelectorAll('.bin')) {
    bin.classList.toggle('is-held', ui.heldIngredient === bin.dataset.ingredient);
  }
}

function renderActiveOrder(shift) {
  const want = plateRecipe(shift.plate);
  const nameEl = $('active-name');
  const slotsEl = $('active-slots');
  if (want === null) {
    nameEl.textContent = shift.plate.length === 0 ? '—' : 'no ticket wants this';
    slotsEl.innerHTML = shift.plate.length === 0 ? '' : `<span class="slot-pip filled"></span>`.repeat(Math.min(shift.plate.length, 8));
    return;
  }
  nameEl.textContent = want.name;
  slotsEl.innerHTML = want.build.map(([id], i) => {
    const filled = i < shift.plate.length ? ' filled' : '';
    return `<span class="slot-pip${filled}"></span>`;
  }).join('');
}

function renderHeld(shift, heldName) {
  const slot = $('held-item');
  const empty = $('held-empty');
  const count = $('held-count');
  if (shift.held === null) {
    empty.hidden = false;
    slot.innerHTML = '';
    count.textContent = '';
    return;
  }
  empty.hidden = true;
  const ing = ingredientById.get(shift.held[0]);
  slot.innerHTML = `<span class="bin-swatch" style="background:${ing.color}"></span> ${ing.name} · ${shift.held[1]}`;
  count.textContent = '';
}

function renderStars(shift) {
  // Stars live in the top bar as a small strip under the score.
  let strip = $('star-strip');
  if (strip === null) {
    strip = document.createElement('div');
    strip.id = 'star-strip';
    strip.style.cssText = 'display:flex;gap:3px;font-size:14px;margin-left:-8px;';
    $('score-value').after(strip);
  }
  const lost = shift.starsLost;
  strip.innerHTML = [0, 1, 2].map((i) => `<span style="opacity:${i < 3 - lost ? 1 : .25};color:${i < 3 - lost ? '#f0b429' : '#e2483a'}">★</span>`).join('');
}

/** A floating toast above the kitchen. */
export function toast(message, kind = '') {
  const layer = $('toast-layer');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  layer.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, 1500);
}

/** Shows the end-of-shift card with the final tally. */
export function showOverlay(kind, data) {
  const overlay = $('overlay');
  overlay.classList.remove('hidden');
  const title = $('overlay-title');
  const body = $('overlay-body');
  const keys = $('overlay-keys');
  const kicker = $('overlay-kicker');
  const start = $('start-button');

  if (kind === 'intro') {
    kicker.textContent = 'FIRELINE KITCHEN';
    title.textContent = 'Dinner Rush';
    keys.style.display = '';
    start.innerHTML = 'OPEN THE PASS &#10148;';
  } else {
    kicker.textContent = data.win ? 'SERVICE COMPLETE' : 'SERVICE OVER';
    title.textContent = data.win ? 'You ran the pass.' : data.reason;
    keys.style.display = 'none';
    body.innerHTML = `
      Plates served: <b>${data.served}</b> &nbsp;·&nbsp; missed: <b>${data.missed}</b><br>
      Best streak: <b>${data.bestStreak}</b> &nbsp;·&nbsp; tips: <b>$${data.tips}</b><br>
      Final score: <b>${data.score}</b>`;
    start.innerHTML = 'RUN IT BACK &#10148;';
  }
}

export function hideOverlay() {
  $('overlay').classList.add('hidden');
}

/** A served plate's little flight to the board, then a fresh empty plate. */
export function serveFlight() {
  const plate = $('plate');
  plate.classList.remove('serve-fly');
  void plate.offsetWidth;              // restart the animation
  plate.classList.add('serve-fly');
}
