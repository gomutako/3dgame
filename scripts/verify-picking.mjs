/**
 * Verifica che nessun tipo di oggetto sia un bersaglio troppo piccolo.
 *
 *   node scripts/verify-picking.mjs [primoLivello] [ultimoLivello]
 *
 * Per ogni pezzo libero campiona una griglia di punti attorno a lui e conta da
 * quanti quel pezzo viene davvero preso. È la misura diretta di «l'area di
 * contatto è piccola».
 *
 * Perché serve: `normalize()` pareggia la **sfera** contenitiva, non l'area
 * della silhouette. Un oggetto pieno riempie la sua sfera; uno fatto per lo più
 * di vuoto — una montatura di occhiali, il manico di una tazza — ne occupa una
 * frazione. Misurato su un set precedente: gli occhiali si prendevano nel 28%
 * dei casi mirando al loro centro, contro il 93% del dado.
 *
 * Da qui il raycast contro lo **scafo convesso** invece della mesh disegnata
 * (vedi `Game.castAtPile`). Effetto misurato: area media da 122,7 a 131,1 punti
 * per pezzo, e nessun tipo peggiorato.
 *
 * La soglia è **relativa alla mediana**, non assoluta: il set di modelli cambia
 * quando se ne aggiungono, e questa guardia deve segnalare un tipo fuori scala
 * rispetto agli altri, non oscillare a ogni modello nuovo.
 */
import * as THREE from 'three';
import { setupHeadless, silentHud } from './headless.mjs';

await setupHeadless();
const { createCamera } = await import('../src/scene/setup.js');
const { updateTweens } = await import('../src/core/tween.js');
const { Game, State } = await import('../src/game/game.js');

const from = Number(process.argv[2]) || 3;
const to = Number(process.argv[3]) || 8;

// Un tipo che offre meno della metà del bersaglio mediano è ingiocabile
// rispetto agli altri: il giocatore lo vive come «questo non si clicca».
const MIN_FRACTION_OF_MEDIAN = 0.5;
const MIN_SAMPLES = 5; // sotto, la media è rumore e il tipo non viene giudicato

const W = 430, H = 860;
const game = new Game({ scene: new THREE.Scene(), camera: createCamera(W / H), hud: silentHud });
const DT = 1 / 60;
const step = () => { updateTweens(DT); game.update(DT); };

const perType = new Map();

for (let level = from; level <= to; level++) {
  await game.startLevel(level);
  let f = 0;
  while (game.state === State.DROPPING && f++ < 3000) step();

  const free = game.occlusion.freeItems().filter((i) => game.items[i]?.state === 'pile');
  for (const idx of free) {
    const item = game.items[idx];
    const c = item.mesh.getWorldPosition(new THREE.Vector3()).project(game.camera);
    const cx = ((c.x + 1) / 2) * W;
    const cy = ((1 - c.y) / 2) * H;

    let hits = 0;
    for (let dy = -30; dy <= 30; dy += 4) {
      for (let dx = -30; dx <= 30; dx += 4) {
        const h = game.castAtScreen(cx + dx, cy + dy, W, H);
        if (h.length && h[0].object.userData.item === item) hits++;
      }
    }

    const name = game.types[item.type].name;
    const s = perType.get(name) ?? { n: 0, px: 0 };
    s.n++;
    s.px += hits;
    perType.set(name, s);
  }
}

const rows = [...perType.entries()]
  .map(([name, s]) => ({ name, n: s.n, area: s.px / s.n }))
  .sort((a, b) => a.area - b.area);

const judged = rows.filter((r) => r.n >= MIN_SAMPLES);
const sorted = [...judged].map((r) => r.area).sort((a, b) => a - b);
const median = sorted.length ? sorted[sorted.length >> 1] : 0;
const floor = median * MIN_FRACTION_OF_MEDIAN;

console.log('tipo                          casi  bersaglio');
console.log('─'.repeat(50));
let failures = 0;
for (const r of rows) {
  const skip = r.n < MIN_SAMPLES;
  const bad = !skip && r.area < floor;
  if (bad) failures++;
  console.log(
    `${r.name.slice(0, 28).padEnd(30)} ${String(r.n).padStart(4)}  ${r.area.toFixed(1).padStart(9)}` +
    (skip ? '   (pochi casi, non giudicato)' : bad ? `   ← sotto ${floor.toFixed(0)}` : '')
  );
}

console.log('─'.repeat(50));
console.log(`mediana ${median.toFixed(1)} · soglia ${floor.toFixed(1)} (metà della mediana)`);

if (failures) {
  console.error(`\n${failures} tipi offrono meno della metà del bersaglio mediano.`);
  process.exit(1);
}
console.log('\nNessun tipo è un bersaglio fuori scala rispetto agli altri.');
