/**
 * Validatore di risolvibilità (DESIGN.md §4.5).
 *
 * Politica greedy randomizzata, la stessa che userebbe un giocatore competente:
 *   1. chiudi una tripletta (2 già nel vassoio)
 *   2. accoppia (1 già nel vassoio)
 *   3. apri un tipo nuovo solo se resta spazio di manovra
 * Con restart multipli è una verifica pratica molto forte; il fallback `spread = 0`
 * in assign.js resta comunque una garanzia matematica.
 */
export function isSolvable(occlusion, types, { slots = 5, tray = [], tries = 24, rng }) {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attemptSolve(occlusion, types, slots, tray, rng)) return true;
  }
  return false;
}

function attemptSolve(occlusion, types, slots, initialTray, rng) {
  const occ = occlusion.clone();
  const counts = new Map();
  let held = 0;

  for (const t of initialTray) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
    held++;
  }

  let guard = occ.remaining * 4 + 16;

  while (occ.remaining > 0 && guard-- > 0) {
    const free = occ.freeItems();
    if (free.length === 0) return false;

    // Quante copie libere per tipo: serve a preferire i tipi chiudibili subito.
    const freeByType = new Map();
    for (const i of free) freeByType.set(types[i], (freeByType.get(types[i]) ?? 0) + 1);

    let best = -1;
    let bestScore = -Infinity;

    for (const i of free) {
      const t = types[i];
      const inTray = counts.get(t) ?? 0;
      let score;

      if (inTray === 2) score = 1000;
      else if (inTray === 1) score = 500 + (freeByType.get(t) ?? 0) * 10;
      else {
        // Aprire un tipo nuovo consuma uno slot: fallo solo se resta respiro.
        if (held >= slots - 1) continue;
        score = 100 + (freeByType.get(t) ?? 0) * 20 - held * 15;
      }

      score += rng.next() * 40; // randomizza fra mosse equivalenti
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (best < 0) return false; // stallo: nessuna mossa sicura

    const t = types[best];
    occ.remove(best);
    const n = (counts.get(t) ?? 0) + 1;

    if (n === 3) {
      counts.delete(t);
      held -= 2;
    } else {
      counts.set(t, n);
      held += 1;
    }

    if (held >= slots) return false; // vassoio pieno
  }

  return occ.remaining === 0 && held === 0;
}
