/**
 * Partita automatica headless: esercita il game loop completo
 * (presa → volo → vassoio → match → vittoria) senza renderer né DOM.
 *
 *   node scripts/playthrough.mjs [primoLivello] [ultimoLivello] [--ruota]
 *
 * Con `--ruota` la scatola viene girata di un angolo a caso fra una presa e l'altra:
 * è il caso che esercita la ricostruzione del grafo al nuovo angolo.
 *
 * Il "giocatore" usa Game.bestMove(), cioè la stessa euristica del suggerimento.
 */
import * as THREE from 'three';
import { setupHeadless, silentHud } from './headless.mjs';

await setupHeadless();
import { createCamera } from '../src/scene/setup.js';
import { updateTweens } from '../src/core/tween.js';
import { Game, State } from '../src/game/game.js';


const noopHud = {
  setLevel() {}, setProgress() {}, setBoosters() {},
  setLoading() {}, showResult() {}, hideResult() {},
};

const from = Number(process.argv[2]) || 1;
const to = Number(process.argv[3]) || 15;
const spinning = process.argv.includes('--ruota');

const scene = new THREE.Scene();
const camera = createCamera(430 / 860);
const game = new Game({ scene, camera, hud: silentHud });

const DT = 1 / 60;
const step = () => { updateTweens(DT); game.update(DT); };

let failures = 0;
console.log('lvl  pezzi  prese  frane  riassetti  spost.  esito');
console.log('─'.repeat(56));

for (let level = from; level <= to; level++) {
  await game.startLevel(level);

  let frames = 0;
  while (game.state === State.DROPPING && frames++ < 3000) step();

  let moved = 0;

  let picks = 0;
  let guard = 200000;
  while (game.state !== State.WON && game.state !== State.LOST && guard-- > 0) {
    // Come un giocatore vero: aspetta che la frana finisca prima della presa
    // successiva. È il ritmo che esercita ricostruzione del grafo e rivalidazione.
    if (game.state === State.PLAYING && !game.pendingSettle && game.tray.canAccept() && game.pile.length > 0) {
      const item = game.bestMove();
      if (!item) break; // stallo: nessun pezzo libero, sarebbe un bug del grafo
      game.take(item);
      picks++;

      if (spinning) {
        game.beginRotate();
        game.rotate((Math.random() - 0.5) * Math.PI);
        game.endRotate(0);
      }
    }
    const before = Float32Array.from(game.physics.snapshot());
    step();
    const after = game.physics.snapshot();
    for (const it of game.pile) {
      const o = it.index * 7;
      moved += Math.abs(after[o] - before[o]) + Math.abs(after[o+1] - before[o+1]) + Math.abs(after[o+2] - before[o+2]);
    }
    frames++;
  }

  const won = game.state === State.WON;
  if (!won) failures++;
  console.log(
    `${String(level).padStart(3)}  ${String(game.total).padStart(5)}  ` +
      `${String(picks).padStart(5)}  ${String(game.settles).padStart(5)}  ` +
      `${String(game.autoReshuffles).padStart(9)}  ${moved.toFixed(1).padStart(6)}  ` +
      (won ? 'vinto' : `NON vinto (stato: ${game.state})`)
  );
}

console.log('─'.repeat(56));
console.log(
  (failures === 0 ? `Livelli ${from}-${to}: tutti completati` : `${failures} livelli non completati`) +
    (spinning ? ', ruotando la scatola fra le prese.' : '.')
);
process.exit(failures === 0 ? 0 : 1);
