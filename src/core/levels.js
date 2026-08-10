import { TYPE_COUNT } from '../scene/shapes.js';

/**
 * Curva di difficoltà — vedi DESIGN.md §3.
 * Tre leve indipendenti: quantità (triples), varietà (types), pianificazione (spread).
 */
export function levelConfig(level) {
  const n = Math.max(1, level);

  // Quantità: cresce in fretta all'inizio, poi si appiattisce.
  const triples = Math.min(30, Math.round(6 + Math.pow(n, 0.82) * 1.35));

  // Varietà: un tipo nuovo ogni ~2 livelli, mai più di una tripletta per tipo mancante.
  const types = Math.min(TYPE_COUNT, triples, 3 + Math.floor(n / 1.8));

  // Pianificazione: quanto sono sparpagliate le copie di una tripletta.
  // È la leva che rende un livello "da pensare" invece che solo lungo.
  let spread = Math.min(16, 1.5 + Math.pow(n, 0.95) * 0.85);

  // Ogni 5 livelli un respiro, per il ritmo della sessione.
  const isBreather = n % 5 === 0;
  if (isBreather) spread *= 0.5;

  return {
    level: n,
    triples,
    types,
    spread,
    isBreather,
    itemCount: triples * 3,
    slots: 5,
    boosters: { undo: 3, hint: 3, shuffle: 1 },
  };
}
