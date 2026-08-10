import { createRenderer, createScene, createCamera, layoutWorld } from './scene/setup.js';
import { loadItemTypes } from './scene/shapes.js';
import { updateTweens } from './core/tween.js';
import { Game, State } from './game/game.js';
import { Hud } from './ui/hud.js';

const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const scene = createScene(renderer);
const camera = createCamera(innerWidth / innerHeight);

const hud = new Hud({
  onUndo: () => game.undo(),
  onHint: () => game.showHint(),
  onShuffle: () => game.shuffle(),
  onContinue: (result) => game.startLevel(result === 'win' ? game.level + 1 : game.level),
});

// I modelli vanno caricati prima: il gioco ne ha bisogno per mesh e collider.
await loadItemTypes();

const game = new Game({ scene, camera, hud });

/**
 * Misure della superficie di gioco.
 *
 * La dimensione viene da `window`, non dal rettangolo del canvas: un canvas non
 * ancora impaginato misura 300×150 — il suo default — e il renderer nascerebbe
 * di quella taglia, disegnando il gioco in un francobollo in alto a sinistra.
 * (Provato: succede davvero, l'HUD resta a posto perché è DOM e non dipende da
 * questa misura.)
 *
 * L'origine invece viene dal canvas: serve a convertire le coordinate del
 * puntatore. Con `position: fixed; inset: 0` è (0, 0), ma sottrarla non costa
 * nulla e regge se un giorno il canvas non occupasse più tutto.
 */
function viewport() {
  const r = canvas.getBoundingClientRect();
  return { w: Math.max(1, innerWidth), h: Math.max(1, innerHeight), left: r.left, top: r.top };
}

function resize() {
  const { w, h } = viewport();
  renderer.setSize(Math.round(w), Math.round(h), false);
  layoutWorld(scene, camera, w / h);
  game.relayout();
}
addEventListener('resize', resize);

// Su iOS le barre di Safari compaiono e scompaiono cambiando l'area visibile,
// e non sempre lo accompagna un `resize` della finestra.
visualViewport?.addEventListener('resize', resize);

resize();

// Un solo dito fa due cose: trascinare gira la scatola, toccare prende un pezzo.
// La soglia in pixel è ciò che li separa — sotto, è un tap anche se la mano trema.
const DRAG_THRESHOLD = 9;
const TURN_PER_SCREEN = Math.PI * 1.8; // un trascinamento pieno ≈ mezzo giro e poco più

let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  drag = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    travel: 0,
    velocity: 0,
    time: performance.now(),
  };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;

  const dx = e.clientX - drag.x;
  drag.travel += Math.abs(dx) + Math.abs(e.clientY - drag.y);
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.travel <= DRAG_THRESHOLD) return;

  if (!game.dragging) game.beginRotate();

  const now = performance.now();
  const angle = (dx / viewport().w) * TURN_PER_SCREEN;
  game.rotate(angle);
  drag.velocity = angle / Math.max(1 / 240, (now - drag.time) / 1000);
  drag.time = now;
});

function endDrag(e, cancelled = false) {
  if (!drag || e.pointerId !== drag.id) return;

  // Un gesto annullato dal browser non è un tap: prenderebbe un pezzo che il
  // giocatore non ha scelto.
  if (cancelled) {
    drag = null;
    game.endRotate(0);
    return;
  }

  const tapped = drag.travel <= DRAG_THRESHOLD;
  // Se il dito si era già fermato prima di staccarsi, niente inerzia:
  // l'utente stava mirando, non lanciando.
  const stale = performance.now() - drag.time > 90;
  const velocity = stale ? 0 : drag.velocity;
  drag = null;

  if (tapped) {
    const { w, h, left, top } = viewport();
    game.pickAt(e.clientX - left, e.clientY - top, w, h);
  } else {
    game.endRotate(velocity);
  }
}

canvas.addEventListener('pointerup', (e) => endDrag(e));
canvas.addEventListener('pointercancel', (e) => endDrag(e, true));

// Debug rapido: ?level=12 per saltare direttamente a un livello.
const startLevel = Number(new URLSearchParams(location.search).get('level')) || 1;
game.startLevel(startLevel);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateTweens(dt);
  game.update(dt);
  renderer.render(scene, camera);
});

// Comodo per ispezionare lo stato dalla console durante il tuning.
Object.assign(globalThis, { game, State, scene, camera, renderer });
