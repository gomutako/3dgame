import RAPIER from '@dimforge/rapier3d-compat';
import { BOX, CELL, spawnColumns } from '../scene/setup.js';
import { ITEM_RADIUS } from '../scene/shapes.js';

let ready = null;
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

const STEP = 1 / 60;
const MAX_SUBSTEPS = 4;
const DROP_STEPS = 420;
const HULL_SKIN = 0.035;   // bordo arrotondato degli scafi: contatti stabili
const MAX_AWAKE = 2.5;     // secondi oltre i quali la pila viene messa a dormire d'ufficio

/**
 * Il mondo fisico della pila, vivo per tutta la durata del livello.
 *
 * Due fasi:
 *  1. `settleAndRecord()` — la caduta, simulata a porte chiuse e registrata frame
 *     per frame per il replay. La prima caduta usa un collider uniforme (serve una
 *     pila che non dipenda ancora dai tipi); poi `setShapes()` monta gli scafi
 *     convessi veri e la caduta si rifà da capo — vedi generate.js.
 *  2. `step()` — durante il gioco. Togliere un pezzo sveglia l'intera pila, che frana
 *     e si riassesta; quando tutto torna a dormire il chiamante ricostruisce il
 *     grafo di occlusione sulle nuove pose. Perché *tutta* e non solo i vicini:
 *     vedi `wakeAll()`.
 */
export class PileWorld {
  constructor(count, rng) {
    this.count = count;
    // -16 invece di -32: circa 1,6× la gravità terrestre. Resta rapido — il
    // livello deve partire in fretta — ma i pezzi non precipitano più come
    // piombo. Più in basso l'assestamento si allunga, e il grafo di occlusione
    // si ricostruisce solo a pila ferma: diventerebbe attesa fra una presa e
    // l'altra.
    this.world = new RAPIER.World({ x: 0, y: -16, z: 0 });
    this.world.timestep = STEP;
    this.bodies = new Array(count).fill(null);
    this.pose = new Float32Array(count * 7);
    this.accumulator = 0;
    this.awakeTime = 0;

    this.buildContainer();
    this.spawn(rng);
    this.spawnPose = Float32Array.from(this.snapshot());
  }

  // ------------------------------------------------------------------- setup

  buildContainer() {
    const s = BOX.size / 2;
    const hw = BOX.wallHeight / 2;
    const t = 0.4;

    const add = (hx, hy, hz, x, y, z) => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9), body);
    };

    add(s + t, t, s + t, 0, BOX.floorY - t, 0);            // fondo
    // Pavimento di sicurezza largo quanto la scena: se un pezzo scavalca il bordo
    // atterra sul piano d'appoggio invece di cadere nel vuoto per sempre —
    // e un corpo in caduta libera non si addormenta mai, bloccando la partita.
    add(20, t, 20, 0, BOX.floorY - 0.42 - t, 0);
    add(s + t, hw, t, 0, BOX.floorY + hw, -(s + t));       // pareti (invisibili)
    add(s + t, hw, t, 0, BOX.floorY + hw, s + t);
    add(t, hw, s + t, -(s + t), BOX.floorY + hw, 0);
    add(t, hw, s + t, s + t, BOX.floorY + hw, 0);
  }

  spawn(rng) {
    const cols = spawnColumns(BOX.size);
    const perLayer = cols * cols;
    // Le colonne si distribuiscono su tutta la larghezza utile, non a passo fisso:
    // con scatole strette altrimenti si formerebbe una torre al centro.
    const usable = Math.max(CELL, BOX.size - ITEM_RADIUS * 2);
    const pitch = usable / cols;

    for (let i = 0; i < this.count; i++) {
      const slot = i % perLayer;
      const layer = Math.floor(i / perLayer);
      const x = ((slot % cols) + 0.5) * pitch - usable / 2 + rng.range(-0.08, 0.08);
      const z = (Math.floor(slot / cols) + 0.5) * pitch - usable / 2 + rng.range(-0.08, 0.08);
      const y = BOX.floorY + ITEM_RADIUS + 0.35 + layer * (CELL * 1.05) + rng.range(0, 0.12);

      this.create(i, { x, y, z }, randomQuat(rng));
    }
  }

  create(index, position, rotation) {
    const h = ITEM_RADIUS * 0.62;     // semi-lato del cuboide interno
    const border = ITEM_RADIUS - h;   // raccordo: gli spigoli non si incastrano

    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        // Smorzamento basso: il moto non muore a metà e gli oggetti rotolano
        // invece di incollarsi dove atterrano.
        .setLinearDamping(0.05)
        .setAngularDamping(0.25)
    );
    // Rimbalzo 0,12 contro lo 0,03 di prima: si sente che gli oggetti non sono
    // di piombo. È la leva che costa più occlusione — un pezzo che rimbalza si
    // allontana dalla pila invece di accatastarcisi — e a 0,20 la pila si
    // appiattiva troppo. Misurato: occlusione iniziale media 17,2% a 0,20,
    // 19,4% a 0,12, 20,4% a 0,06, contro 21,1% dello 0,03 originale.
    // L'attrito, che sembrava la leva principale, non sposta nulla: fra 0,65 e
    // 0,85 l'occlusione varia dell'1%, dentro il rumore.
    this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(h, h, h, border).setFriction(0.75).setRestitution(0.12),
      body
    );
    this.bodies[index] = body;
    return body;
  }

  /**
   * Rimette tutti i pezzi dove sono nati, fermi.
   * Serve a rifare la caduta con le forme vere: ripartire dalla griglia di spawn,
   * dove nessuno tocca nessuno, evita le compenetrazioni che si avrebbero
   * scambiando i collider su una pila già assestata (pezzi sparati fuori).
   */
  resetToSpawn() {
    for (let i = 0; i < this.count; i++) {
      const body = this.bodies[i];
      if (!body) continue;
      const o = i * 7;
      body.setTranslation({ x: this.spawnPose[o], y: this.spawnPose[o + 1], z: this.spawnPose[o + 2] }, true);
      body.setRotation(
        { x: this.spawnPose[o + 3], y: this.spawnPose[o + 4], z: this.spawnPose[o + 5], w: this.spawnPose[o + 6] },
        true
      );
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.wakeUp();
    }
    this.accumulator = 0;
    this.awakeTime = 0;
  }

  // -------------------------------------------------------------- simulazione

  /** Simula fino all'assestamento registrando ogni frame (per il replay). */
  settleAndRecord(maxSteps = DROP_STEPS) {
    const frames = [];
    for (let s = 0; s < maxSteps; s++) {
      this.world.step();
      frames.push(this.snapshot().slice());
      if (s > 30 && s % 6 === 0 && this.asleep()) break;
    }
    this.forceSleep(); // il livello deve partire da una pila ferma, sempre
    return { frames, poses: this.snapshot().slice() };
  }

  asleep() {
    for (const body of this.bodies) if (body && !body.isSleeping()) return false;
    return true;
  }

  /**
   * Avanza la simulazione a passo fisso.
   * @returns {boolean} true finché qualcosa si muove (il chiamante sincronizza le mesh)
   */
  step(dt) {
    if (this.asleep()) {
      this.awakeTime = 0;
      return false;
    }

    this.accumulator = Math.min(this.accumulator + dt, STEP * MAX_SUBSTEPS);
    while (this.accumulator >= STEP) {
      this.world.step();
      this.accumulator -= STEP;
    }

    // Contatti fra spigoli possono vibrare all'infinito senza mai addormentarsi.
    // Oltre il limite la pila viene fermata: una simulazione irrequieta non deve
    // poter bloccare la partita.
    this.awakeTime += dt;
    if (this.awakeTime > MAX_AWAKE) {
      this.forceSleep();
      this.awakeTime = 0;
      return false;
    }
    return true;
  }

  forceSleep() {
    for (const body of this.bodies) body?.sleep();
  }

  /**
   * Sostituisce i collider con lo scafo convesso della forma vera di ogni pezzo.
   * Va fatto DOPO aver deciso i tipi: la caduta iniziale usa un collider uniforme
   * proprio per non dipendere da essi (DESIGN.md §4).
   */
  setShapes(typeOf, hulls) {
    for (let i = 0; i < this.count; i++) {
      const body = this.bodies[i];
      if (!body) continue;

      const type = typeOf[i];
      if (type < 0) continue;

      // Scafo *arrotondato*: la punta di un cono resta una punta, ma il contatto
      // ha un margine e non vibra. I punti sono già rimpiccioliti di HULL_SKIN,
      // così l'ingombro finale coincide con la forma disegnata.
      //
      // Prima si costruisce, poi si sostituisce. Rimuovere per primo e poi
      // rinunciare lascerebbe il corpo SENZA collider — cioè attraversa il fondo
      // e cade per sempre — mentre l'intenzione è tenersi quello di prima.
      // Su una nuvola di punti degenere Rapier non restituisce null: va in
      // panico dal wasm, quindi non basta controllare il valore di ritorno.
      let desc = null;
      try {
        desc = RAPIER.ColliderDesc.roundConvexHull(hulls[type], HULL_SKIN);
      } catch {
        desc = null;
      }
      if (!desc) continue; // scafo degenere: tiene il collider uniforme

      while (body.numColliders() > 0) this.world.removeCollider(body.collider(0), false);
      this.world.createCollider(desc.setFriction(0.75).setRestitution(0.12), body);
      body.wakeUp();
    }
  }

  // ------------------------------------------------------------- modifiche

  /** Toglie un pezzo dalla pila e sveglia chi ci stava sopra o accanto. */
  remove(index) {
    const body = this.bodies[index];
    if (!body) return;

    this.world.removeRigidBody(body);
    this.bodies[index] = null;
    this.wakeAll();
  }

  /** Rimette un pezzo (undo): la pila gli fa spazio da sola. */
  insert(index, position, quaternion) {
    if (this.bodies[index]) return;
    this.create(index, position, quaternion);
    this.wakeAll();
  }

  /**
   * Sveglia TUTTA la pila, non un intorno del pezzo toccato.
   *
   * Sembra uno spreco e non lo è. Un corpo che perde l'appoggio ma resta
   * marcato dormiente riceve da Rapier l'integrazione della gravità **senza**
   * le forze di contatto: cade libero attraverso il fondo finché il motore non
   * lo sveglia da sé. Sullo schermo è un pezzo che sprofonda sotto il piano e
   * poi risale di scatto; nei casi peggiori esce dal mondo e non torna.
   *
   * Con un raggio fisso il bug è inevitabile: qualunque soglia lascia fuori un
   * corpo che l'appoggio lo perde comunque, perché la catena di appoggi è più
   * lunga della distanza (misurato: 1,709 contro un raggio di 1,496).
   *
   * Costa meno della versione "furba": i tuffi e le risalite erano movimento
   * spurio da simulare. Sui livelli 1-15 lo spostamento totale al livello 15
   * scende da 559 a 38 e la partita automatica accelera.
   * Copertura: `npm run verify:physics`.
   */
  wakeAll() {
    for (const body of this.bodies) body?.wakeUp();
  }

  // ------------------------------------------------------------------- pose

  /**
   * 7 float per pezzo (posizione + quaternione). I pezzi già tolti conservano
   * l'ultima posa nota: chi legge li esclude comunque.
   */
  snapshot() {
    for (let i = 0; i < this.count; i++) {
      const body = this.bodies[i];
      if (!body) continue;
      const p = body.translation();
      const q = body.rotation();
      const o = i * 7;
      this.pose[o] = p.x; this.pose[o + 1] = p.y; this.pose[o + 2] = p.z;
      this.pose[o + 3] = q.x; this.pose[o + 4] = q.y; this.pose[o + 5] = q.z; this.pose[o + 6] = q.w;
    }
    return this.pose;
  }

  dispose() {
    this.world.free();
    this.bodies.fill(null);
  }
}

function randomQuat(rng) {
  // Shoemake: quaternione uniforme sulla sfera 4D.
  const u1 = rng.next(), u2 = rng.next() * Math.PI * 2, u3 = rng.next() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) };
}
