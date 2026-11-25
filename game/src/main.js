// main.js — boots the kitchen, owns the clock, and turns input into model actions.

import { INGREDIENTS, RECIPES, TOOLS, TUNING } from './data.js';
import {
  createShift, makeTicket, maybeSpawn, plateRecipe, matchingTicket,
  startTool, tickBoard, tickStoves, collectTool, servePlate, trashPlate,
  dropHeld, ageTickets, updateRush, checkEnd, plateHasRoom, toolFor,
} from './state.js';
import { buildStaticUi, render, toast, showOverlay, hideOverlay, serveFlight } from './render.js';
import { Sound } from './sound.js';

const ingredientById = new Map(INGREDIENTS.map((i) => [i.id, i]));
const $ = (id) => document.getElementById(id);

/** A deterministic-enough RNG so a shift differs every run but replays stay stable under ?seed. */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const params = new URLSearchParams(location.search);
const rng = makeRng(Number(params.get('seed')) || Date.now() % 100000);

/** A screenshot pause: ?shot=<name> freezes the clock and, when `plate` is given, builds that plate. */
function applyShotOverride(shiftRef) {
  const name = params.get('shot');
  if (name === null) return false;
  const now = performance.now();
  shiftRef.tickets = [];
  shiftRef.plate = [];
  shiftRef.held = null;
  const wanted = params.get('plate');
  if (wanted !== null) {
    const pieces = wanted.split(',').filter(Boolean).map((pair) => {
      const [id, st] = pair.split(':');
      return [id, st];
    });
    shiftRef.plate = pieces;
  }
  const ticketNames = (params.get('tickets') ?? 'Ember Noodle Bowl').split('|').filter(Boolean);
  ticketNames.forEach((label, i) => {
    const recipe = RECIPES.find((r) => r.name === label) ?? RECIPES[i % RECIPES.length];
    const ticket = makeTicket(recipe, now, i > 0);
    ticket.totalMs = Number(params.get('ticketms') ?? ticket.totalMs);
    ticket.remainingMs = ticket.totalMs * (Number(params.get(`frac${i}`) ?? 0.72));
    shiftRef.tickets.push(ticket);
  });
  return true;
}

let shift = null;
let running = false;
let paused = false;
let lastFrame = 0;
let now = 0;

const ui = {
  canServe: false,
  heldIngredient: null,
};

// ------------------------------------------------------------------ setup

buildStaticUi({
  onBin: pickIngredient,
  onTool: useTool,
  onChop: chop,
  onServe: serve,
  onTrash: trash,
});

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'm') { toggleMute(); return; }
  if (key === 'p') { togglePause(); return; }
  if (!running || paused) return;

  const ing = INGREDIENTS.find((i) => i.key === key);
  if (ing !== undefined) { pickIngredient(ing.id); return; }

  if (key === 'c') { chop(); return; }
  if (key === 's') { useTool(); return; }
  if (key === 'x') { dropHeldPiece(); return; }
  if (key === 'enter') { event.preventDefault(); serve(); return; }
  if (key === 'backspace' || key === 'delete') { event.preventDefault(); trash(); return; }
});

$('start-button').addEventListener('click', startOrRestart);
$('serve-button').addEventListener('click', serve);
$('trash-button').addEventListener('click', trash);
$('pause-button').addEventListener('click', togglePause);
$('mute-button').addEventListener('click', toggleMute);

function toggleMute() {
  const muted = Sound.toggle();
  $('mute-button').innerHTML = muted ? '&#128263;' : '&#128266;';
  toast(muted ? 'Sound off' : 'Sound on');
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  $('pause-button').textContent = paused ? '▶' : 'II';
  if (paused) toast('Paused — press P to resume');
}

function startOrRestart() {
  if (shift !== null && !shift.finished) { hideOverlay(); return; }
  beginShift();
}

function beginShift() {
  now = performance.now();
  shift = createShift(now);
  const frozen = applyShotOverride(shift);
  running = true;
  paused = false;
  $('pause-button').textContent = 'II';
  if (!frozen) {
    // an opening pair of tickets so the board is never empty
    maybeSpawn(shift, now, rng, true);
    maybeSpawn(shift, now + 60, rng, true);
  }
  lastFrame = now;
  hideOverlay();
  if (frozen) return;              // screenshots hold the scene still
  toast('Service! Tickets are landing.', 'gold');
}

// ------------------------------------------------------------------ actions

function pickIngredient(id) {
  if (shift === null || shift.finished || paused) return;
  const ing = ingredientById.get(id);
  if (shift.held !== null) { toast('Your hands are full — plate or cook what you hold first.', 'bad'); Sound.warn(); return; }
  if (!plateHasRoom(shift)) { toast('The plate is full.', 'bad'); return; }

  // Nothing cooks this ingredient: it goes straight onto the plate.
  const tool = toolFor(id);
  if (tool === undefined) {
    shift.plate.push([id, ing.state]);
    Sound.place();
    afterPlacement();
    return;
  }
  shift.held = [id, ing.state];
  ui.heldIngredient = id;
  Sound.pickup();
  toast(`${ing.name} in hand — ${tool.kind === 'board' ? 'press C to chop' : `press S for the ${tool.name}`}`);
}

/** The board key: something in hand goes to the board; a finished chop is plated at once. */
function chop() {
  if (shift === null || paused || shift.finished) return;
  const board = shift.tools.find((t) => t.kind === 'board');
  if (shift.held !== null) { startTool(shift, board.id, now); return; }
  if (board.item !== null && board.done) { collectTool(shift, board.id, now); placeOnPlate(); }
}

/** The stove key: start what is in hand, or take a ready/burnt piece off its fire. */
function useTool(toolId) {
  if (shift === null || paused || shift.finished) return;
  let target = toolId;
  if (target === undefined) {
    // No argument: pick the stove that wants the held piece, else one holding food.
    if (shift.held !== null) {
      const wants = TOOLS.find((t) => t.kind === 'stove' && t.accepts.includes(shift.held[0]));
      target = wants?.id;
    }
    if (target === undefined) {
      const busy = shift.tools.find((t) => t.kind === 'stove' && t.item !== null);
      target = busy?.id ?? 'stove-pot';
    }
  }
  const tool = shift.tools.find((t) => t.id === target);
  if (tool === undefined) return;
  if (tool.kind === 'board') { chop(); return; }
  if (tool.item !== null) { collectFromTool(target); return; }
  startTool(shift, target, now);
}

/** Called whenever a piece lands on the plate, from any path. */
function afterPlacement() {
  const want = plateRecipe(shift.plate);
  if (want === null) return;
  const ticket = matchingTicket(shift);
  if (ticket !== null) toast(`${want.name} plated — Enter serves ticket #${ticket.id}`, 'good');
}

function placeOnPlate() {
  if (shift === null || shift.held === null) return;
  if (!plateHasRoom(shift)) { toast('The plate is full.', 'bad'); return; }
  const piece = shift.held;
  shift.plate.push(piece);
  shift.held = null;
  ui.heldIngredient = null;
  Sound.place();
  afterPlacement();
}

function collectFromTool(toolId) {
  const piece = collectTool(shift, toolId, now);
  if (piece === null) { toast('Your hands are full.', 'bad'); return; }
  if (piece[1] === 'burnt') toast('That burnt. Serve it or bin it.', 'bad');
  Sound.done();
}

function dropHeldPiece() {
  if (shift === null || shift.held === null) return;
  dropHeld(shift);
  ui.heldIngredient = null;
  Sound.trash();
  toast('Dropped in the sink.');
}

function serve() {
  if (shift === null || paused || shift.finished) return;
  const outcome = servePlate(shift, now);
  if (outcome === null) {
    toast('No open ticket matches that plate.', 'bad');
    Sound.warn();
    return;
  }
  Sound.serve();
  serveFlight();
  toast(`Served ${outcome.ticket.recipe.name} · +$${outcome.earned} ($${outcome.speedBonus} speed)`, 'good');
}

function trash() {
  if (shift === null || paused || shift.finished) return;
  if (trashPlate(shift)) { Sound.trash(); toast('Plate binned. Streak reset.', 'bad'); }
}

// ------------------------------------------------------------------ loop

function frame(t) {
  requestAnimationFrame(frame);
  if (shift === null) return;
  const dt = Math.min(64, t - lastFrame);
  lastFrame = t;
  if (!running || paused) { now = t; renderCurrent(); return; }
  now = t;

  ageTickets(shift, dt);
  for (const ev of tickBoard(shift, now)) {
    if (ev.type === 'chopped') { Sound.chop(); Sound.done(); toast(`${label(ev.piece)} chopped — plate it`); }
  }
  for (const ev of tickStoves(shift, now)) {
    if (ev.type === 'ready') { Sound.done(); toast(`${label(ev.piece)} ready — take it with S`, 'gold'); }
    else if (ev.type === 'burnt') { Sound.miss(); toast('Something burnt on the fire!', 'bad'); }
  }
  if (updateRush(shift, now)) { Sound.rush(); toast('SERVICE RUSH — tickets are coming faster!', 'bad'); }
  maybeSpawn(shift, now, rng);

  const ended = checkEnd(shift, now);
  if (ended !== null) { endShift(ended); }

  renderCurrent();
}

function label(piece) {
  const ing = ingredientById.get(piece[0]);
  return `${ing.name} (${piece[1]})`;
}

function renderCurrent() {
  ui.canServe = matchingTicket(shift) !== null;
  render({ shift, now }, ui);
}

function endShift(result) {
  running = false;
  ui.canServe = false;
  renderCurrent();
  if (result.win) Sound.win(); else Sound.over();
  showOverlay('end', {
    win: result.win,
    reason: result.reason,
    served: shift.served,
    missed: shift.missed,
    bestStreak: shift.bestStreak,
    tips: shift.tips,
    score: shift.score,
  });
}

// Clicking the plate puts the held piece on it; clicking the food area does the same.
$('plate').addEventListener('click', placeOnPlate);
$('prep-area').addEventListener('click', (e) => {
  if (e.target.closest('#serve-button, #trash-button') !== null) return;
  if (shift !== null && shift.held !== null) placeOnPlate();
});

// Screenshot hooks: ?shot=fly serves the first matching ticket for a flying-plate capture.
if (params.get('shot') === 'fly') {
  setTimeout(() => { serve(); }, Number(params.get('delay')) || 150);
}

requestAnimationFrame(frame);
showOverlay('intro');
