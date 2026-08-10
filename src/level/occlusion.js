import * as THREE from 'three';
import { ITEM_RADIUS } from '../scene/shapes.js';

/**
 * Modello esatto della "cliccabilità" (DESIGN.md §4.2).
 *
 * Campiono la pila con una griglia di raggi che partono dalla camera di gioco e
 * per ogni raggio conservo i pezzi colpiti in ordine di profondità.
 * Un pezzo è LIBERO ⟺ esiste un raggio in cui è il primo non ancora rimosso.
 *
 * È lo stesso criterio del raycast di input, quindi ciò che il solver considera
 * raggiungibile coincide con ciò che il giocatore può davvero toccare.
 */

const GRID = 48;
const RADIUS_SCALE = 1.05; // leggermente generoso: meglio pessimisti che impossibili

export class Occlusion {
  /** @param {Int32Array[]} rays liste di indici, ordinate per profondità */
  constructor(rays, itemCount) {
    this.rays = rays;
    this.itemCount = itemCount;
    this.excluded = new Uint8Array(itemCount);
    this.removed = new Uint8Array(itemCount);
    this.head = new Int32Array(rays.length);
    this.headRays = Array.from({ length: itemCount }, () => []);
    this.reset();
  }

  /** Segna oggetti che non fanno parte del livello: né cliccabili né ostacoli. */
  setExcluded(indices) {
    this.excluded.fill(0);
    for (const i of indices) this.excluded[i] = 1;
    this.reset();
  }

  reset() {
    this.removed.set(this.excluded);
    this.remaining = 0;
    for (let i = 0; i < this.itemCount; i++) {
      this.headRays[i].length = 0;
      if (!this.excluded[i]) this.remaining++;
    }
    for (let r = 0; r < this.rays.length; r++) {
      const ray = this.rays[r];
      let h = 0;
      while (h < ray.length && this.removed[ray[h]]) h++;
      this.head[r] = h;
      if (h < ray.length) this.headRays[ray[h]].push(r);
    }
  }

  clone() {
    const copy = Object.create(Occlusion.prototype);
    copy.rays = this.rays;
    copy.itemCount = this.itemCount;
    copy.excluded = this.excluded;
    copy.removed = new Uint8Array(this.removed);
    copy.head = new Int32Array(this.head);
    copy.headRays = this.headRays.map((list) => list.slice());
    copy.remaining = this.remaining;
    return copy;
  }

  isFree(i) {
    return !this.removed[i] && this.headRays[i].length > 0;
  }

  freeItems() {
    const out = [];
    for (let i = 0; i < this.itemCount; i++) if (this.isFree(i)) out.push(i);
    return out;
  }

  /** Rimuove un pezzo e fa avanzare i raggi che lo avevano in testa. */
  remove(i) {
    if (this.removed[i]) return;
    this.removed[i] = 1;
    this.remaining--;

    const orphaned = this.headRays[i];
    this.headRays[i] = [];

    for (const r of orphaned) {
      const ray = this.rays[r];
      let h = this.head[r];
      while (h < ray.length && this.removed[ray[h]]) h++;
      this.head[r] = h;
      if (h < ray.length) this.headRays[ray[h]].push(r);
    }
  }

  /** Reinserisce un pezzo (undo): ricostruisce lo stato, operazione rara. */
  restore(i) {
    if (!this.removed[i] || this.excluded[i]) return;
    const snapshot = Uint8Array.from(this.removed);
    snapshot[i] = 0;
    this.reset();
    for (let k = 0; k < snapshot.length; k++) {
      if (snapshot[k] && !this.excluded[k]) this.remove(k);
    }
  }
}

/**
 * Costruisce il grafo campionando lo schermo.
 * @param {Float32Array} poses 7 float per oggetto
 * @param {THREE.Camera} camera
 */
export function buildOcclusion(poses, count, camera) {
  const radius = ITEM_RADIUS * RADIUS_SCALE;
  const r2 = radius * radius;

  const centers = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    centers[i * 3] = poses[i * 7];
    centers[i * 3 + 1] = poses[i * 7 + 1];
    centers[i * 3 + 2] = poses[i * 7 + 2];
  }

  // Bounding box in screen space, con margine per i bordi dei pezzi.
  const p = new THREE.Vector3();
  let minX = 1, maxX = -1, minY = 1, maxY = -1;
  for (let i = 0; i < count; i++) {
    p.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]).project(camera);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const m = 0.1;
  minX = Math.max(-1, minX - m); maxX = Math.min(1, maxX + m);
  minY = Math.max(-1, minY - m); maxY = Math.min(1, maxY + m);

  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3();
  const rays = [];
  const hits = [];
  const covered = new Uint8Array(count);

  const cast = (ndcX, ndcY) => {
    dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();

    hits.length = 0;
    for (let i = 0; i < count; i++) {
      const ox = origin.x - centers[i * 3];
      const oy = origin.y - centers[i * 3 + 1];
      const oz = origin.z - centers[i * 3 + 2];
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - r2;
      const disc = b * b - c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = -b - sq;
      if (t < 0) t = -b + sq;
      if (t < 0) continue;
      hits.push(t, i);
    }
    if (hits.length === 0) return;

    const order = [];
    for (let k = 0; k < hits.length; k += 2) order.push(k);
    order.sort((a, b2) => hits[a] - hits[b2]);
    for (const k of order) covered[hits[k + 1]] = 1;
    rays.push(Int32Array.from(order, (k) => hits[k + 1]));
  };

  for (let gy = 0; gy < GRID; gy++) {
    const ndcY = minY + ((gy + 0.5) / GRID) * (maxY - minY);
    for (let gx = 0; gx < GRID; gx++) {
      cast(minX + ((gx + 0.5) / GRID) * (maxX - minX), ndcY);
    }
  }

  // Rete di sicurezza: un pezzo che nessun raggio della griglia ha toccato non
  // diventerebbe mai libero e andrebbe scartato dal livello. Gli dedichiamo un
  // raggio passante per il suo centro, così la copertura è completa per costruzione.
  for (let i = 0; i < count; i++) {
    if (covered[i]) continue;
    p.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]).project(camera);
    cast(p.x, p.y);
  }

  return new Occlusion(rays, count);
}

/**
 * Ordine di sfoltimento: sfoglia ripetutamente l'insieme libero.
 * Il risultato è per costruzione una sequenza di rimozione legale.
 */
export function peelOrder(occlusion, rng) {
  const occ = occlusion.clone();
  const order = [];
  while (occ.remaining > 0) {
    const free = occ.freeItems();
    if (free.length === 0) break; // non dovrebbe accadere: ogni pila ha una cima
    const pick = free[rng.int(free.length)];
    occ.remove(pick);
    order.push(pick);
  }
  return order;
}
