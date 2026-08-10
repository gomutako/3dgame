/**
 * Harness di regressione per il generatore di livelli.
 *
 *   node scripts/verify-levels.mjs [primoLivello] [ultimoLivello]
 *
 * Gira senza browser: fisica, occlusione e solver sono pura logica.
 * Verifica, per ogni livello: conteggi coerenti, ogni tipo in multipli di 3,
 * e risolvibilità confermata da un solver indipendente con più tentativi.
 */
import * as THREE from 'three';
import { setupHeadless, silentHud } from './headless.mjs';

await setupHeadless();
import { createCamera, layoutWorld, computeBoxSize, BOX } from '../src/scene/setup.js';
import { levelConfig } from '../src/core/levels.js';
import { Rng, levelSeed } from '../src/core/rng.js';
import { generateLevel } from '../src/level/generate.js';
import { isSolvable } from '../src/level/solver.js';

const SEED = 20260810;
const from = Number(process.argv[2]) || 1;
const to = Number(process.argv[3]) || 25;

const camera = createCamera(430 / 860); // inquadratura verticale tipo iPhone
const scene = new THREE.Scene();
let failures = 0;

console.log('lvl  pezzi  tipi  spread  scatola  gen(ms)  passate  scartati  risolvibile');
console.log('─'.repeat(78));

for (let level = from; level <= to; level++) {
  const cfg = levelConfig(level);
  const rng = new Rng(levelSeed(SEED, level));

  // Stesse condizioni del gioco: la camera definisce il grafo di occlusione.
  layoutWorld(scene, camera, camera.aspect, computeBoxSize(cfg.itemCount));

  const t0 = performance.now();
  const data = await generateLevel(cfg, camera, rng);
  const ms = performance.now() - t0;

  // Ogni tipo deve comparire in multipli di 3, altrimenti il livello è invincibile.
  const counts = new Map();
  for (const i of data.active) counts.set(data.types[i], (counts.get(data.types[i]) ?? 0) + 1);
  const balanced = [...counts.values()].every((c) => c % 3 === 0);

  // Seconda opinione: solver indipendente, seed diverso, più tentativi.
  const solvable = isSolvable(data.occlusion, data.types, {
    slots: cfg.slots,
    rng: new Rng(0xbeef + level),
    tries: 60,
  });

  data.physics.dispose(); // ogni livello tiene vivo un mondo Rapier: va liberato

  const ok = balanced && solvable && data.active.length % 3 === 0;
  if (!ok) failures++;

  console.log(
    `${String(level).padStart(3)}  ${String(data.active.length).padStart(5)}  ` +
      `${String(counts.size).padStart(4)}  ${cfg.spread.toFixed(1).padStart(6)}  ` +
      `${BOX.size.toFixed(1).padStart(7)}  ${ms.toFixed(0).padStart(7)}  ` +
      `${String(data.settleAttempts).padStart(7)}  ${String(data.excluded.length).padStart(8)}  ` +
      `${ok ? '  ok' : '  FALLITO'}${balanced ? '' : ' (tipi sbilanciati)'}${solvable ? '' : ' (non risolvibile)'}`
  );
}

console.log('─'.repeat(78));
console.log(failures === 0 ? `Tutti i livelli ${from}-${to} sono validi.` : `${failures} livelli non validi.`);
process.exit(failures === 0 ? 0 : 1);
