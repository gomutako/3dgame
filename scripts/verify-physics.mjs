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
 *
 * Misura anche le due grandezze che una fisica più molle peggiorerebbe:
 *
 *  · **assestamento** — quanti frame passano da una presa alla pila ferma. È il
 *    ritmo del gioco: il grafo di occlusione si ricostruisce solo a pila ferma,
 *    quindi un assestamento lungo diventa attesa fra una presa e l'altra.
 *
 *  · **occlusione iniziale** — quanti pezzi sono coperti a pila appena caduta.
 *    È il puzzle stesso. Meno attrito e più rimbalzo sparpagliano la pila, e
 *    senza sovrapposizione restano solo oggetti da toccare in ordine.
 *
 * Baseline al 2026-08-10, livelli 1-12: assestamento mediano 45 frame (0,75 s),
 * occlusione iniziale media 16,5%.
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

console.log('lvl  prese   minY  sotto  discesa  assest.med  assest.max  occl.iniz%');
console.log('─'.repeat(74));

let failures = 0;
const allOccluded = [];
const allSettle = [];

const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

for (let level = from; level <= to; level++) {
  await game.startLevel(level);
  let f = 0;
  while (game.state === State.DROPPING && f++ < 3000) step();

  let minY = Infinity;
  let sunk = 0;
  let maxDip = 0;
  let picks = 0;
  const settleFrames = [];

  // Occlusione a pila appena caduta, PRIMA di ogni presa.
  //
  // Va misurata qui e non mediata sulla partita: togliendo pezzi la pila si
  // abbassa e verso la fine è scoperta per forza, quindi una media sull'intero
  // livello dice più che altro quanto dura il finale. È il valore iniziale che
  // corrisponde al «circa un terzo dei pezzi coperti» di DESIGN.md §5, ed è la
  // grandezza che una fisica più molle farebbe crollare appiattendo la pila.
  const startOccluded = game.pile.length
    ? 1 - game.occlusion.freeItems().filter((i) => game.items[i]?.state === 'pile').length / game.pile.length
    : 0;
  allOccluded.push(startOccluded);

  while (game.state === State.PLAYING || game.state === State.BUSY) {
    const item = game.bestMove();
    if (!item) break;
    game.take(item);
    picks++;

    const lowest = new Map();
    let frames = 0;
    for (let k = 0; k < 400; k++) {
      step();
      frames++;
      game.physics.bodies.forEach((b, i) => {
        if (!b) return;
        const y = b.translation().y;
        lowest.set(i, Math.min(lowest.get(i) ?? Infinity, y));
        if (y < minY) minY = y;
        if (y < BOX.floorY) sunk++;
      });
      if (game.physics.asleep()) break;
    }
    settleFrames.push(frames);

    game.physics.bodies.forEach((b, i) => {
      if (!b) return;
      maxDip = Math.max(maxDip, b.translation().y - (lowest.get(i) ?? Infinity));
    });
    if (picks > 60) break;
  }

  allSettle.push(...settleFrames);

  const bad = sunk > 0;
  if (bad) failures++;
  console.log(
    `${String(level).padStart(3)}  ${String(picks).padStart(5)}  ` +
    `${minY.toFixed(2).padStart(5)}  ${String(sunk).padStart(5)}  ${maxDip.toFixed(3).padStart(7)}  ` +
    `${String(median(settleFrames)).padStart(10)}  ${String(Math.max(0, ...settleFrames)).padStart(10)}  ` +
    `${(startOccluded * 100).toFixed(1).padStart(8)}` +
    (bad ? '   ← sprofonda' : '')
  );
}

console.log('─'.repeat(74));

const occPct = mean(allOccluded) * 100;
const settleMed = median(allSettle);

console.log(`assestamento mediano: ${settleMed} frame  (${(settleMed / 60).toFixed(2)} s)`);
console.log(`occlusione iniziale media: ${occPct.toFixed(1)}%`);

if (failures) {
  console.error(`\n${failures} livelli con pezzi sotto il piano della scatola (BOX.floorY = ${BOX.floorY}).`);
  process.exit(1);
}

// Sotto questa soglia la pila è troppo piatta: senza sovrapposizione non c'è
// puzzle, solo una fila di oggetti da toccare in ordine (DESIGN.md §5).
//
// La soglia è 12 e non il «circa un terzo» di DESIGN.md perché questa è una
// MEDIA sui livelli chiesti, e i primi della curva hanno pile piccole con
// poca o nessuna sovrapposizione. Un livello medio da solo sta sul 20-33%.
if (occPct < 12) {
  console.error(`\nOcclusione iniziale media ${occPct.toFixed(1)}%: sotto il 12%, la pila è troppo piatta.`);
  process.exit(1);
}

console.log(`\nNessun pezzo sotto il piano; occlusione iniziale sopra la soglia del 12%.`);
