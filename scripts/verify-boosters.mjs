/**
 * Test dei booster: undo, hint, shuffle.
 *
 *   node scripts/verify-boosters.mjs [livello]
 *
 * Lo shuffle è il più delicato: deve conservare il multiinsieme dei tipi rimasti
 * E lasciare il livello risolvibile tenendo conto di cosa c'è già nel vassoio.
 */
import * as THREE from 'three';
import { setupHeadless, silentHud } from './headless.mjs';

await setupHeadless();
import { createCamera } from '../src/scene/setup.js';
import { updateTweens } from '../src/core/tween.js';
import { Game, State } from '../src/game/game.js';
import { isSolvable } from '../src/level/solver.js';
import { Rng } from '../src/core/rng.js';



const DT = 1 / 60;
const settle = (frames = 60) => { for (let i = 0; i < frames; i++) { updateTweens(DT); game.update(DT); } };
/** Avanza finché la pila ha finito di franare (o si arrende dopo `max` frame). */
const settleUntilQuiet = (max = 900) => {
  for (let i = 0; i < max; i++) {
    updateTweens(DT); game.update(DT);
    if (!game.pendingSettle && i > 30) return true;
  }
  return false;
};
const multiset = (items, types) => {
  const m = new Map();
  for (const i of items) m.set(types[i], (m.get(types[i]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => `${t}x${n}`).join(' ');
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

const level = Number(process.argv[2]) || 6;
const game = new Game({ scene: new THREE.Scene(), camera: createCamera(430 / 860), hud: silentHud });

await game.startLevel(level);
while (game.state === State.DROPPING) settle(1);
console.log(`Livello ${level}: ${game.total} pezzi\n`);

// --- UNDO -------------------------------------------------------------------
const before = { pile: game.pile.length, undo: game.boosters.undo };
const first = game.bestMove();
const spot = first.mesh.position.clone();
game.take(first);
settleUntilQuiet();

const wasTaken = game.tray.size === 1 && game.pile.length === before.pile - 1;
check('la presa entra nel vassoio', wasTaken, `vassoio=${game.tray.size}`);

const undone = game.undo();
const quiet = settleUntilQuiet();
check('undo riporta il pezzo nella pila', undone && game.tray.size === 0 && game.pile.length === before.pile);
check('undo scala il contatore', game.boosters.undo === before.undo - 1);
check('la pila si riassesta dopo l\'undo', quiet && game.physics.bodies[first.index] !== null);
check('il pezzo annullato è di nuovo selezionabile', game.occlusion.isFree(first.index));
// Con la fisica viva il pezzo ricade: si riposa vicino a dov'era, non esattamente lì.
check('il pezzo annullato si riposa vicino al suo posto',
  first.mesh.position.distanceTo(spot) < 1.5,
  `distanza ${first.mesh.position.distanceTo(spot).toFixed(2)}`);

// --- HINT -------------------------------------------------------------------
const hinted = game.showHint();
check('hint indica un pezzo libero', hinted && game.hint !== null && game.occlusion.isFree(game.hint.item.index));
check('hint scala il contatore', game.boosters.hint === 2);
settle(140);
check('il pulsare finisce e ripristina la scala', game.hint === null && Math.abs(first.mesh.scale.x - 1) < 1e-3);

// --- SHUFFLE ----------------------------------------------------------------
// Riempie il vassoio con tipi diversi: lo scenario in cui lo shuffle serve davvero.
const seen = new Set();
for (const i of game.occlusion.freeItems()) {
  const it = game.items[i];
  if (!it || it.state !== 'pile' || seen.has(it.type)) continue;
  seen.add(it.type);
  game.take(it);
  settleUntilQuiet();
  if (seen.size === 3) break;
}

const remaining = game.pile.map((i) => i.index);
const typesBefore = multiset(remaining, game.itemTypes);
const trayTypes = game.tray.types();

const shuffled = game.shuffle();
settle(60);
settleUntilQuiet();

const typesAfter = multiset(remaining, game.itemTypes);
check('shuffle eseguito', shuffled && game.boosters.shuffle === 0);
check('shuffle conserva il multiinsieme dei tipi', typesBefore === typesAfter, typesAfter);
check(
  'shuffle conserva la mesh coerente col tipo',
  game.pile.every((i) => i.mesh.geometry === game.types[i.type].geometry && i.type === game.itemTypes[i.index])
);
check(
  'dopo lo shuffle il livello resta risolvibile',
  isSolvable(game.occlusion, game.itemTypes, { slots: 5, tray: trayTypes, rng: new Rng(7), tries: 60 })
);

// --- il livello si porta comunque a termine ---------------------------------
let guard = 100000;
while (game.state !== State.WON && game.state !== State.LOST && guard-- > 0) {
  if (game.state === State.PLAYING && game.tray.canAccept() && game.pile.length > 0) {
    const it = game.bestMove();
    if (!it) break;
    game.take(it);
  }
  settle(1);
}
check('livello completato dopo undo + hint + shuffle', game.state === State.WON, `stato=${game.state}`);

console.log(`\n${failures === 0 ? 'Tutti i booster si comportano come previsto.' : failures + ' controlli falliti.'}`);
process.exit(failures === 0 ? 0 : 1);
