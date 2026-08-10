/**
 * PRNG deterministico (mulberry32).
 * Un livello è definito da (seed, numero livello): stesso input, stesso livello.
 */
export class Rng {
  constructor(seed = 1) {
    this.state = seed >>> 0;
  }

  /** float in [0, 1) */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [min, max) */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** intero in [0, n) */
  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(array) {
    return array[this.int(array.length)];
  }

  /** Fisher-Yates in place */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

/** Combina seed globale e numero di livello in un seed stabile. */
export function levelSeed(seed, level) {
  return (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(level + 1, 0xc2b2ae35)) >>> 0;
}
