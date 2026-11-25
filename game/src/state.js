// state.js — the shift's model: tickets, the plate, tools and scoring. Pure logic, no DOM.

import { RECIPES, TOOLS, TUNING, matchRecipe, tipScale } from './data.js';

let nextTicketId = 1;

/** A ticket as it lives on the board. `recipe` is a RECIPES entry; `deadlineMs` counts down. */
export function makeTicket(recipe, now, rush) {
  const total = rush ? TUNING.rushTicketMs : TUNING.ticketMs;
  return {
    id: nextTicketId++,
    recipe,
    totalMs: total,
    remainingMs: total,
    deadline: now + total,
    rush: !!rush,
  };
}

/** Everything the shift holds at one moment. */
export function createShift(now) {
  return {
    startedAt: now,
    endsAt: now + TUNING.shiftSeconds * 1000,
    tickets: [],
    starsLost: 0,
    score: 0,
    tips: 0,
    served: 0,
    missed: 0,
    streak: 0,
    bestStreak: 0,
    rush: false,
    lastSpawnAt: now,
    // the plate: an ordered list of [ingredientId, state]
    plate: [],
    held: null,            // the piece in hand, or null
    tools: TOOLS.map((t) => ({ ...t, busyUntil: 0, readyAt: 0, done: false, item: null })),
    finished: false,
    result: null,
  };
}

/** Picks a recipe the kitchen can still make, weighted toward dishes with more pieces. */
export function pickRecipe(rng) {
  const weights = RECIPES.map((r) => r.build.length >= 4 ? 3 : r.build.length === 3 ? 4 : 5);
  let sum = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * sum;
  for (let i = 0; i < RECIPES.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return RECIPES[i];
  }
  return RECIPES[0];
}

/**
 * Adds a ticket when the board has room and the spawn clock says so.
 * Returns 'spawned' | 'waited' | 'full'.
 */
export function maybeSpawn(shift, now, rng, force = false) {
  const open = shift.tickets.filter((t) => t.remainingMs > 0).length;
  const cap = shift.rush ? Math.min(TUNING.maxTickets, 5) : TUNING.startTickets + Math.floor((now - shift.startedAt) / 60000);
  if (open >= Math.min(cap, TUNING.maxTickets)) return 'full';
  const every = shift.rush ? TUNING.rushSpawnEveryMs : TUNING.spawnEveryMs;
  if (!force && now - shift.lastSpawnAt < every) return 'waited';
  shift.lastSpawnAt = now;
  const recipe = pickRecipe(rng);
  const ticket = makeTicket(recipe, now, shift.rush);
  shift.tickets.push(ticket);
  return 'spawned';
}

/** True when the plate's pieces are exactly a recipe's build list, in order. */
export function plateRecipe(plate) {
  return matchRecipe(plate.map(([id, state]) => [id, state]));
}

/** The first ticket whose recipe matches the plate exactly. */
export function matchingTicket(shift) {
  const want = plateRecipe(shift.plate);
  if (want === null) return null;
  let best = null;
  for (const t of shift.tickets) {
    if (t.remainingMs <= 0) continue;
    if (t.recipe.id !== want.id) continue;
    if (best === null || t.remainingMs < best.remainingMs) best = t;
  }
  return best;
}

/** Whether the plate can take another piece. */
export function plateHasRoom(shift) {
  return shift.plate.length < TUNING.plateLimit;
}

/** The tool that wants this ingredient now, or null (nothing cooks it). */
export function toolFor(ingredientId) {
  for (const tool of TOOLS) {
    if (tool.accepts.includes(ingredientId)) return tool;
  }
  return null;
}

/** Starts a tool job; returns its tool or null when it cannot run now. */
export function startTool(shift, toolId, now) {
  const tool = shift.tools.find((t) => t.id === toolId);
  if (tool === undefined || shift.held === null) return null;
  if (!tool.accepts.includes(shift.held[0])) return null;
  if (tool.kind === 'board') {
    if (now < tool.busyUntil) return null;
    tool.busyUntil = now + tool.durationMs;
    tool.item = shift.held;
    shift.held = null;
    return tool;
  }
  if (tool.kind === 'stove') {
    if (tool.done || now < tool.busyUntil) return null;
    tool.busyUntil = now + tool.durationMs;
    tool.readyAt = now + tool.durationMs;
    tool.burnAt = now + tool.durationMs + tool.burnMs;
    tool.item = shift.held;
    shift.held = null;
    return tool;
  }
  return null;
}

/** Advances a board tool: finishes its chop and holds the prepared piece on the board. */
export function tickBoard(shift, now) {
  const events = [];
  for (const tool of shift.tools) {
    if (tool.kind !== 'board') continue;
    if (tool.item === null || now < tool.busyUntil) continue;
    if (tool.done) continue;                       // already chopped, waiting to be plated
    const [id] = tool.item;
    const state = tool.produces[id];
    tool.item = [id, state];
    tool.done = true;
    events.push({ type: 'chopped', tool, piece: [id, state] });
  }
  return events;
}

/** Advances stove tools: readies them, and burns whatever sits past its window. */
export function tickStoves(shift, now) {
  const events = [];
  for (const tool of shift.tools) {
    if (tool.kind !== 'stove') continue;
    if (tool.item === null) continue;
    if (tool.done) {
      // sitting burnt: waits for the cook to take it
      continue;
    }
    if (now >= tool.readyAt) {
      const [id] = tool.item;
      const state = now >= tool.burnAt ? 'burnt' : tool.produces[id];
      tool.done = true;
      tool.item = [id, state];
      events.push({ type: state === 'burnt' ? 'burnt' : 'ready', tool, piece: [id, state] });
    }
  }
  return events;
}

/** Takes a finished piece off its tool into the hand, when the hand is empty. */
export function collectTool(shift, toolId, now) {
  const tool = shift.tools.find((t) => t.id === toolId);
  if (tool === undefined || !tool.done || shift.held !== null) return null;
  const piece = tool.item;
  tool.item = null;
  tool.done = false;
  tool.busyUntil = now;
  shift.held = piece;
  return piece;
}
/** The plate's visual pile: pieces as [id, state]. */
export function platePieces(shift) {
  return shift.plate.slice();
}

/** Serves the matching ticket. Returns the outcome, or null when nothing matched. */
export function servePlate(shift, now) {
  const ticket = matchingTicket(shift);
  if (ticket === null) return null;
  const scale = tipScale(ticket.remainingMs, ticket.totalMs);
  const payout = Math.round(ticket.recipe.base * scale);
  const speedBonus = Math.round(payout * 0.25);
  const earned = payout + speedBonus;
  shift.score += earned;
  shift.tips += Math.round(payout * (scale - 1));
  shift.served += 1;
  shift.streak += 1;
  shift.bestStreak = Math.max(shift.bestStreak, shift.streak);
  shift.plate = [];
  shift.tickets = shift.tickets.filter((t) => t.id !== ticket.id);
  return { ticket, payout, speedBonus, earned, scale };
}

/** Trashes the plate, breaking the streak. */
export function trashPlate(shift) {
  if (shift.plate.length === 0) return false;
  shift.plate = [];
  shift.streak = 0;
  return true;
}

/** Drops a held piece into the sink without touching the plate. */
export function dropHeld(shift) {
  if (shift.held === null) return false;
  shift.held = null;
  return true;
}

/**
 * Ages every ticket by `dtMs`, dropping expired ones and charging a star.
 * Returns the tickets that just timed out.
 */
export function ageTickets(shift, dtMs) {
  const expired = [];
  for (const t of shift.tickets) {
    if (t.remainingMs <= 0) continue;
    t.remainingMs -= dtMs;
    if (t.remainingMs <= 0) {
      t.remainingMs = 0;
      expired.push(t);
      shift.starsLost += 1;
      shift.missed += 1;
      shift.streak = 0;
    }
  }
  shift.tickets = shift.tickets.filter((t) => t.remainingMs > 0);
  return expired;
}

/** The active rush flag, from the clock. */
export function updateRush(shift, now) {
  const was = shift.rush;
  shift.rush = now >= shift.startedAt + TUNING.rushAtMs;
  return shift.rush && !was;
}

/** The shift's end: three lost stars, or the clock running out. */
export function checkEnd(shift, now) {
  if (shift.finished) return shift.result;
  if (shift.starsLost >= TUNING.starsToLose) {
    shift.finished = true;
    shift.result = { over: true, win: false, reason: 'Three tickets walked out.' };
    return shift.result;
  }
  if (now >= shift.endsAt) {
    shift.finished = true;
    shift.result = { over: true, win: shift.served >= 8, reason: shift.served >= 8 ? 'Shift complete.' : 'The pass closed early.' };
    return shift.result;
  }
  return null;
}

