/**
 * Assegnazione dei tipi (DESIGN.md §4.4).
 *
 * L'idea: partire da un ordine di rimozione *legale* e tagliarlo in triplette.
 * Con `spread = 0` le tre copie sono consecutive → il giocatore non tiene mai più
 * di 3 pezzi in mano → livello risolvibile per costruzione.
 * Aumentando `spread` le copie si allontanano e serve pianificare: è la difficoltà.
 */

/** Perturba localmente un ordine: nessun elemento si sposta di molto più di `spread`. */
export function jitterOrder(order, spread, rng) {
  if (spread <= 0) return order.slice();
  return order
    .map((item, i) => ({ item, key: i + rng.range(-spread, spread) }))
    .sort((a, b) => a.key - b.key)
    .map((e) => e.item);
}

/** Sequenza di tipi bilanciata: `triples` triplette distribuite su `typeCount` tipi. */
export function balancedSequence(triples, typeCount, rng) {
  const perTriple = [];
  for (let j = 0; j < triples; j++) perTriple.push(j % typeCount);
  rng.shuffle(perTriple);

  const seq = [];
  for (const t of perTriple) seq.push(t, t, t);
  return seq;
}

/**
 * Sequenza per il booster shuffle: rispetta i pezzi già nel vassoio.
 * In testa vanno i pezzi che chiudono i gruppi aperti, così restano raggiungibili presto.
 *
 * @param {Map<number, number>} counts  tipo → copie ancora nella pila
 * @param {Map<number, number>} trayCounts tipo → copie nel vassoio
 */
export function sequenceFromRemaining(counts, trayCounts, rng) {
  const head = [];
  const perTriple = [];

  for (const [type, total] of counts) {
    const held = trayCounts.get(type) ?? 0;
    const need = held === 0 ? 0 : 3 - held;
    for (let k = 0; k < need; k++) head.push(type);

    const rest = total - need;
    for (let k = 0; k < rest / 3; k++) perTriple.push(type);
  }

  rng.shuffle(perTriple);
  rng.shuffle(head);

  const seq = head.slice();
  for (const t of perTriple) seq.push(t, t, t);
  return seq;
}

/**
 * Mappa una sequenza di tipi su un ordine di rimozione perturbato.
 * @returns {Int32Array} tipo per indice di oggetto (-1 = oggetto non usato)
 */
export function assignTypes(order, sequence, spread, rng, itemCount) {
  const shuffled = jitterOrder(order, spread, rng);
  const types = new Int32Array(itemCount).fill(-1);
  const n = Math.min(shuffled.length, sequence.length);
  for (let k = 0; k < n; k++) types[shuffled[k]] = sequence[k];
  return types;
}
