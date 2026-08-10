/**
 * Verifica che l'input resti vivo durante l'animazione della tripletta.
 *
 *   node scripts/verify-input.mjs [livello]
 *
 * Il *pop* dura FLIGHT + CLEAR (~0,7 s). Bloccare il dito per tutto quel tempo
 * a ogni tripletta spezza il ritmo, e il vassoio logico è già coerente da
 * subito: `Tray.insert()` toglie i tre pezzi appena il match si forma, quindi
 * `canAccept()` dice già il vero mentre l'animazione va avanti.
 *
 * Le due trappole che il permesso apre, e che questo file sorveglia:
 *
 *  · `finishMatch` rimetteva PLAYING senza guardare lo stato. Riempiendo il
 *    vassoio durante il pop, la sconfitta scatta a FLIGHT e finishMatch a
 *    FLIGHT + CLEAR: il giocatore veniva resuscitato da sconfitto.
 *  · la vittoria è decisa in `finishMatch`, e con due pop sovrapposti poteva
 *    dichiararsi mentre dei pezzi stavano ancora volando.
 */
import * as THREE from 'three';
import { setupHeadless, silentHud } from './headless.mjs';

await setupHeadless();
const { createCamera } = await import('../src/scene/setup.js');
const { updateTweens } = await import('../src/core/tween.js');
const { Game, State } = await import('../src/game/game.js');

const level = Number(process.argv[2]) || 9;
const W = 430, H = 860;
const DT = 1 / 60;

const game = new Game({ scene: new THREE.Scene(), camera: createCamera(W / H), hud: silentHud });
const step = () => { updateTweens(DT); game.update(DT); };

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'NO  '} ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

async function fresh() {
  await game.startLevel(level);
  let f = 0;
  while (game.state === State.DROPPING && f++ < 3000) step();
}

/** Punto dello schermo che prende `item`. */
function screenOf(item) {
  const v = item.mesh.getWorldPosition(new THREE.Vector3()).project(game.camera);
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
}

/** Un pezzo libero diverso da quelli indicati. */
function freeItem(exclude = []) {
  const free = game.occlusion.freeItems().filter((i) => game.items[i]?.state === 'pile');
  for (const i of free) {
    const item = game.items[i];
    if (exclude.includes(item)) continue;
    const [x, y] = screenOf(item);
    const hit = game.castAtScreen(x, y, W, H);
    if (hit.length && hit[0].object.userData.item === item) return item;
  }
  return null;
}

/** Porta il vassoio a formare una tripletta e la lascia in animazione. */
function triggerMatch() {
  for (let guard = 0; guard < 60; guard++) {
    const item = game.bestMove();
    if (!item) return false;
    const sizeBefore = game.tray.size;
    game.take(item);
    if (game.tray.size < sizeBefore) return true; // il match ha svuotato gli slot
    for (let k = 0; k < 200 && !game.physics.asleep(); k++) step();
  }
  return false;
}

console.log(`Livello ${level}\n`);

// ---------------------------------------------------------------- 1. la presa
await fresh();
check(triggerMatch(), 'una tripletta si forma');
step(); // siamo dentro l'animazione del pop

const during = freeItem();
check(during !== null, 'c\'è ancora un pezzo libero da prendere');
const trayBefore = game.tray.size;
const [x, y] = screenOf(during);
const taken = game.pickAt(x, y, W, H);
check(taken === during, 'si può prendere un pezzo durante il pop',
  taken ? `preso ${game.types[taken.type].name}` : 'input rifiutato');
check(game.tray.size === trayBefore + 1 || game.tray.size < trayBefore,
  'il pezzo è entrato nel vassoio', `vassoio ${trayBefore} → ${game.tray.size}`);

// L'animazione deve comunque chiudersi bene.
for (let k = 0; k < 400 && game.state !== State.PLAYING; k++) step();
check(game.state === State.PLAYING, 'il gioco torna giocabile dopo il pop', `stato=${game.state}`);

// ------------------------------------------------- 2. la sconfitta non si annulla
console.log('');
await fresh();
check(triggerMatch(), 'una seconda tripletta si forma');
step();

// Riempie il vassoio con tipi tutti diversi finché scatta la sconfitta.
let guard = 0;
while (game.tray.size < game.tray.slots && guard++ < 40) {
  const free = game.occlusion.freeItems().filter((i) => game.items[i]?.state === 'pile');
  const open = new Set(game.tray.types());
  const item = free.map((i) => game.items[i]).find((it) => it && !open.has(it.type));
  if (!item) break;
  game.take(item);
}

if (game.tray.isFull) {
  for (let k = 0; k < 400; k++) step();
  check(game.state === State.LOST, 'la sconfitta non viene annullata dalla fine del pop',
    `stato=${game.state}`);
} else {
  console.log('  --   vassoio non riempibile a questo livello, caso non esercitato');
}

// ------------------------------------------------------------ 3. la vittoria
console.log('');
await fresh();
let moves = 0;
while (game.state === State.PLAYING && moves++ < 200) {
  const item = game.bestMove();
  if (!item) break;
  game.take(item);
  for (let k = 0; k < 200 && !game.physics.asleep(); k++) step();
}
for (let k = 0; k < 600 && game.state !== State.WON && game.state !== State.LOST; k++) step();
check(game.state === State.WON, 'il livello si vince ancora', `stato=${game.state}`);
check(game.pile.length === 0 && game.tray.size === 0,
  'a vittoria dichiarata non resta nulla', `pila=${game.pile.length} vassoio=${game.tray.size}`);

console.log('');
if (failures) {
  console.error(`${failures} controlli falliti.`);
  process.exit(1);
}
console.log('L\'input resta vivo durante il pop, senza rompere sconfitta e vittoria.');
