// data.js — the kitchen's catalogue: ingredients, preparation methods, recipes and shift tuning.
// One job: describe what can be built and how, so the rest of the game never hardcodes food names.

/** The eight bins on the counter. `key` is its number key; `state` is how it leaves the bin. */
export const INGREDIENTS = [
  { id: 'noodles', name: 'Noodles', note: 'boil in the pot', state: 'raw', color: '#f0dca4', key: '1' },
  { id: 'bun', name: 'Bun', note: 'toasts on the plancha', state: 'raw', color: '#e8a85c', key: '2' },
  { id: 'patty', name: 'Patty', note: 'sears on the grill', state: 'raw', color: '#7a4a2c', key: '3' },
  { id: 'tomato', name: 'Tomato', note: 'chop at the board', state: 'chopped', color: '#e2483a', key: '4' },
  { id: 'lettuce', name: 'Lettuce', note: 'chop at the board', state: 'chopped', color: '#69b45c', key: '5' },
  { id: 'cheese', name: 'Cheese', note: 'slice at the board', state: 'chopped', color: '#f6c453', key: '6' },
  { id: 'onion', name: 'Onion', note: 'rings on the grill', state: 'cooked', color: '#efe0cf', key: '7' },
];

/** The two tool zones that transform ingredients, and what each accepts. */
export const TOOLS = [
  {
    id: 'board',
    kind: 'board',
    name: 'CHOP',
    glyph: '✂',
    sub: 'press C to chop',
    durationMs: 900,
    accepts: ['tomato', 'lettuce', 'cheese'],
    produces: { tomato: 'chopped', lettuce: 'chopped', cheese: 'chopped' },
    verb: 'Chopping',
  },
  {
    id: 'stove-pot',
    kind: 'stove',
    slot: 'pot',
    name: 'POT',
    glyph: '♨',
    sub: 'press S to boil',
    durationMs: 2200,
    burnMs: 2600,
    accepts: ['noodles'],
    produces: { noodles: 'cooked' },
    verb: 'Boiling',
  },
  {
    id: 'stove-grill',
    kind: 'stove',
    slot: 'grill',
    name: 'GRILL',
    glyph: '▤',
    sub: 'press S to sear',
    durationMs: 1900,
    burnMs: 2400,
    accepts: ['patty', 'onion', 'bun'],
    produces: { patty: 'cooked', onion: 'cooked', bun: 'cooked' },
    verb: 'Searing',
  },
];

/**
 * Recipes a ticket can ask for. `build` lists the wanted pieces in order:
 *   [ingredientId, state] — state is 'raw' (as it leaves the bin) or a prepared one.
 * `method` shows the technique words on the recipe card; `base` is its payout before tips.
 */
export const RECIPES = [
  { id: 'noodle-bowl', name: 'Ember Noodle Bowl', base: 26, method: 'boiled + chopped', build: [['noodles', 'cooked'], ['tomato', 'chopped']] },
  { id: 'garden-bowl', name: 'Garden Bowl', base: 24, method: 'no heat · chopped', build: [['noodles', 'raw'], ['lettuce', 'chopped']] },
  { id: 'classic-burger', name: 'Fireline Burger', base: 32, method: 'grilled + chopped', build: [['bun', 'cooked'], ['patty', 'cooked'], ['tomato', 'chopped'], ['lettuce', 'chopped']] },
  { id: 'cheeseburger', name: 'Molten Cheeseburger', base: 38, method: 'grilled + sliced', build: [['bun', 'cooked'], ['patty', 'cooked'], ['cheese', 'chopped']] },
  { id: 'onion-burger', name: 'Ringmaster Burger', base: 36, method: 'all grilled', build: [['bun', 'cooked'], ['patty', 'cooked'], ['onion', 'cooked']] },
  { id: 'house-stack', name: 'House Stack', base: 46, method: 'the full pass', build: [['bun', 'cooked'], ['patty', 'cooked'], ['cheese', 'chopped'], ['tomato', 'chopped'], ['lettuce', 'chopped']] },
];

/** Shift pacing: how many tickets are open at once, how long they last, when the rush hits. */
export const TUNING = {
  shiftSeconds: 210,
  startTickets: 2,
  maxTickets: 4,
  ticketMs: 34000,
  spawnEveryMs: 5200,
  rushAtMs: 150000,        // from 2:30 the rush begins and tickets come faster
  rushTicketMs: 27000,
  rushSpawnEveryMs: 3600,
  starsToLose: 3,          // three missed tickets ends the shift
  chopMs: 900,
  plateLimit: 8,           // pieces a plate can hold
  perfectWindowMs: 8000,   // served this fast after the last piece earns a bonus
};

/** How much a ticket pays by the time it is served, as a share of its base. */
export function tipScale(remainingMs, totalMs) {
  const frac = Math.max(0, remainingMs / totalMs);
  if (frac > 0.6) return 1.5;
  if (frac > 0.3) return 1.25;
  if (frac > 0) return 1.0;
  return 0.8;
}

/** The recipe whose build list equals `pieces` (order matters), or null. */
export function matchRecipe(pieces) {
  for (const recipe of RECIPES) {
    if (recipe.build.length !== pieces.length) continue;
    let same = true;
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i][0] !== recipe.build[i][0] || pieces[i][1] !== recipe.build[i][1]) { same = false; break; }
    }
    if (same) return recipe;
  }
  return null;
}

/** The recipes still worth showing on the card, given which have been cooked tonight. */
export function recipesForShift() {
  return RECIPES;
}
