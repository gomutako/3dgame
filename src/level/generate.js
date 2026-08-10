import { initPhysics, PileWorld } from './physics.js';
import { buildOcclusion, peelOrder } from './occlusion.js';
import { assignTypes, balancedSequence, sequenceFromRemaining } from './assign.js';
import { isSolvable } from './solver.js';
import { getHulls } from '../scene/shapes.js';

/**
 * Pipeline completa di generazione del livello — DESIGN.md §4.
 *
 * C'è una circolarità da sciogliere: i collider seguono la forma, la forma è il
 * tipo, e i tipi si decidono guardando la pila… che dipende dai collider.
 * La si scioglie in due tempi e poi si itera fino a un punto fisso:
 *
 *   1. caduta con collider uniforme  → una pila qualsiasi, indipendente dai tipi
 *   2. da quella pila: ordine di sfoltimento → assegnazione dei tipi
 *   3. si montano le forme vere e si RIFÀ la caduta dall'inizio  ← la pila vera
 *   4. si rifà il grafo sulla pila nuova e si rivalida l'assegnazione
 *      se non regge, si riparte dal punto 2 con l'ordine della pila nuova
 *
 * Il livello consegnato è validato sulla pila che il giocatore vedrà davvero,
 * non su quella provvisoria del punto 1.
 */
export async function generateLevel(cfg, camera, rng) {
  await initPhysics();

  // Il mondo fisico resta vivo per tutto il livello: la pila frana davvero
  // quando togli un pezzo (vedi PileWorld e DESIGN.md §5).
  const physics = new PileWorld(cfg.itemCount, rng);
  const drop = physics.settleAndRecord();

  let occlusion = buildOcclusion(drop.poses, cfg.itemCount, camera);
  let order = peelOrder(occlusion, rng);
  const usable = order.length - (order.length % 3);

  // Pezzi che nessun raggio campionato raggiunge mai (rarissimo): fuori dal livello.
  const excluded = [];
  if (usable !== cfg.itemCount) {
    const keep = new Set(order.slice(0, usable));
    for (let i = 0; i < cfg.itemCount; i++) if (!keep.has(i)) excluded.push(i);
    occlusion.setExcluded(excluded);
    order = peelOrder(occlusion, rng);
  }

  const triples = order.length / 3;
  const typeCount = Math.max(1, Math.min(cfg.types, triples));
  // Tavolozza del livello: quali modelli rappresentano i tipi 0..typeCount-1.
  //
  // Estratta dal rng del livello, non da Math.random: README e DESIGN.md §7
  // garantiscono che (seed, numero livello) produca un livello identico, e le
  // quattro suite di verifica hanno senso solo grazie a questo — un test che
  // gira ogni volta su un livello diverso non verifica nulla.
  //
  // Il resto della pipeline continua a ragionare su id densi 0..typeCount-1:
  // solver, occlusione e vassoio non sanno nulla dei modelli. La tavolozza è
  // il solo punto che li lega, e serve a mesh e collider.
  const allHulls = getHulls();
  const palette = pickPalette(allHulls.length, typeCount, rng);
  const hulls = palette.map((m) => allHulls[m]);

  let types = null;
  let nestle = null;
  let spread = cfg.spread;
  let attempts = 0;

  for (; attempts < 5; attempts++) {
    const candidate = assignTypes(
      order,
      balancedSequence(triples, typeCount, rng),
      // Ultimo tentativo a spread 0: triplette consecutive, il caso più facile.
      attempts === 4 ? 0 : spread,
      rng,
      cfg.itemCount
    );

    // Le forme vere entrano in gioco: coni, piramidi e poliedri smettono di
    // comportarsi da scatole. La caduta si rifà da capo dalla griglia di spawn:
    // scambiare i collider su una pila già posata creerebbe compenetrazioni, e
    // Rapier le risolve sparando i pezzi fuori dalla scatola.
    physics.resetToSpawn();
    physics.setShapes(candidate, hulls);
    const settled = physics.settleAndRecord();
    const graph = buildOcclusion(settled.poses, cfg.itemCount, camera);
    if (excluded.length) graph.setExcluded(excluded);

    if (isSolvable(graph, candidate, { slots: cfg.slots, rng }) || attempts === 4) {
      types = candidate;
      occlusion = graph;
      nestle = settled;
      break;
    }

    // Non regge: riprovo leggendo l'ordine dalla pila appena assestata.
    order = peelOrder(graph, rng);
    spread *= 0.6;
  }

  return {
    physics,
    poses: nestle.poses,
    // Il replay è la caduta con le forme vere: quella provvisoria non si vede mai.
    frames: nestle.frames,
    types,
    palette,
    occlusion,
    order,
    active: order.slice(),
    excluded,
    triples,
    typeCount,
    settleAttempts: attempts + 1,
  };
}

/** Sottoinsieme di `count` modelli su `total`, senza ripetizioni (Fisher-Yates). */
function pickPalette(total, count, rng) {
  const pool = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, total));
}

/**
 * Booster shuffle: ripermuta i tipi dei pezzi ancora nella pila tenendo conto
 * di ciò che è già nel vassoio, e ri-valida la risolvibilità.
 * @returns {Int32Array|null}
 */
export function reshuffleTypes(occlusion, remaining, types, trayTypes, spread, rng) {
  const counts = new Map();
  for (const i of remaining) counts.set(types[i], (counts.get(types[i]) ?? 0) + 1);

  const trayCounts = new Map();
  for (const t of trayTypes) trayCounts.set(t, (trayCounts.get(t) ?? 0) + 1);

  let width = spread;
  for (let attempt = 0; attempt < 6; attempt++, width *= 0.55) {
    const order = peelOrder(occlusion, rng);
    const candidate = assignTypes(
      order,
      sequenceFromRemaining(counts, trayCounts, rng),
      width,
      rng,
      types.length
    );
    if (isSolvable(occlusion, candidate, { slots: 5, tray: trayTypes, rng })) return candidate;
  }

  const order = peelOrder(occlusion, rng);
  return assignTypes(order, sequenceFromRemaining(counts, trayCounts, rng), 0, rng, types.length);
}
