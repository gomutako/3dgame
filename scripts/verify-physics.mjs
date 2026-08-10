/**
 * Verifica che la pila non sprofondi nel fondo della scatola.
 *
 *   node scripts/verify-physics.mjs [primoLivello] [ultimoLivello]
 *
 * Un corpo il cui CENTRO scende sotto `BOX.floorY` è dentro il collider del
 * fondo: sullo schermo il pezzo si vede entrare nel piano e poi risalire.
 *
 * Il caso che lo produce è un corpo che perde l'appoggio ma resta marcato
 * dormiente: Rapier gli integra la gravità e non gli applica le forze di
 * contatto, così cade libero finché non si sveglia da sé. Il rimedio è
 * svegliare TUTTA la pila a ogni modifica, non un intorno a raggio fisso —
 * un raggio qualunque lascia sempre un corpo appena oltre il confine.
 */
import * as THREE from 'three';
import { setupHeadless, silentHud } from './headless.mjs';

await setupHeadless();
const { createCamera, BOX } = await import('../src/scene/setup.js');
const { updateTweens } = await import('../src/core/tween.js');
const { Game, State } = await import('../src/game/game.js');

const from = Number(process.argv[2]) || 1;
const to = Number(process.argv[3]) || 12;

const DT = 1 / 60;
const game = new Game({ scene: new THREE.Scene(), camera: createCamera(430 / 860), hud: silentHud });
const step = () => { updateTweens(DT); game.update(DT); };

console.log('lvl  prese  minY del centro  sotto il piano  discesa max');
console.log('─'.repeat(60));

let failures = 0;

for (let level = from; level <= to; level++) {
  await game.startLevel(level);
  let f = 0;
  while (game.state === State.DROPPING && f++ < 3000) step();

  let minY = Infinity;
  let sunk = 0;
  let maxDip = 0;
  let picks = 0;

  while (game.state === State.PLAYING || game.state === State.BUSY) {
    const item = game.bestMove();
    if (!item) break;
    game.take(item);
    picks++;

    const lowest = new Map();
    for (let k = 0; k < 400; k++) {
      step();
      game.physics.bodies.forEach((b, i) => {
        if (!b) return;
        const y = b.translation().y;
        lowest.set(i, Math.min(lowest.get(i) ?? Infinity, y));
        if (y < minY) minY = y;
        if (y < BOX.floorY) sunk++;
      });
      if (game.physics.asleep()) break;
    }
    game.physics.bodies.forEach((b, i) => {
      if (!b) return;
      maxDip = Math.max(maxDip, b.translation().y - (lowest.get(i) ?? Infinity));
    });
    if (picks > 60) break;
  }

  const bad = sunk > 0;
  if (bad) failures++;
  console.log(
    `${String(level).padStart(3)}  ${String(picks).padStart(5)}  ` +
    `${minY.toFixed(3).padStart(15)}  ${String(sunk).padStart(14)}  ${maxDip.toFixed(3).padStart(11)}` +
    (bad ? '   ← sprofonda' : '')
  );
}

console.log('─'.repeat(60));
if (failures) {
  console.error(`\n${failures} livelli con pezzi sotto il piano della scatola (BOX.floorY = ${BOX.floorY}).`);
  process.exit(1);
}
console.log(`Nessun pezzo scende sotto il piano della scatola (BOX.floorY = ${BOX.floorY}).`);
