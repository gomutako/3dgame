/** Tween manager minimale: nessuna dipendenza, aggiornato dal render loop. */

const active = [];

export const Ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  outBack: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2),
  outElastic: (t) =>
    t === 0 || t === 1 ? t : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * 2.6) + 1,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

/**
 * @param {object} opts
 * @param {number} opts.duration secondi
 * @param {number} [opts.delay] secondi
 * @param {(t:number)=>void} opts.onUpdate riceve il progresso già "eased"
 * @param {()=>void} [opts.onComplete]
 */
export function tween({ duration, delay = 0, ease = Ease.outCubic, onUpdate, onComplete }) {
  const t = { duration, delay, ease, onUpdate, onComplete, elapsed: 0, killed: false };
  active.push(t);
  return t;
}

export function kill(handle) {
  if (handle) handle.killed = true;
}

export function killAll() {
  active.length = 0;
}

export function updateTweens(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const t = active[i];
    if (t.killed) {
      active.splice(i, 1);
      continue;
    }
    t.elapsed += dt;
    if (t.elapsed < t.delay) continue;

    const p = Math.min(1, (t.elapsed - t.delay) / t.duration);
    t.onUpdate(t.ease(p), p);

    if (p >= 1) {
      active.splice(i, 1);
      t.onComplete?.();
    }
  }
}
