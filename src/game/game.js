import * as THREE from 'three';
import { getItemTypes, getHulls, getPickGeometries } from '../scene/shapes.js';
import { traySlotPosition, layoutWorld, computeBoxSize, getArena, TRAY } from '../scene/setup.js';
import { levelConfig } from '../core/levels.js';
import { Rng, levelSeed } from '../core/rng.js';
import { tween, kill, killAll, Ease } from '../core/tween.js';
import { generateLevel, reshuffleTypes } from '../level/generate.js';
import { buildOcclusion } from '../level/occlusion.js';
import { isSolvable } from '../level/solver.js';
import { Tray } from './tray.js';

export const State = {
  LOADING: 'loading',
  DROPPING: 'dropping',
  PLAYING: 'playing',
  BUSY: 'busy',
  WON: 'won',
  LOST: 'lost',
};

const FLIGHT = 0.38;   // durata del volo pila → vassoio
const CLEAR = 0.34;    // durata del pop della tripletta
const DROP_SPEED = 1.6;

export class Game {
  constructor({ scene, camera, hud, seed = 20260810 }) {
    this.scene = scene;
    this.camera = camera;
    this.hud = hud;
    this.seed = seed;

    this.allTypes = getItemTypes();
    this.allPickGeometries = getPickGeometries();
    // Rimpiazzata a ogni livello dalla tavolozza estratta in generateLevel:
    // i tipi non sono più sempre i primi N modelli dell'elenco.
    this.types = this.allTypes;
    this.pickGeometries = this.allPickGeometries;
    this.state = State.LOADING;
    this.level = 1;

    // I pezzi vivono dentro l'arena: ruotano insieme alla scatola.
    this.arena = getArena(scene);
    this.group = new THREE.Group();
    this.arena.add(this.group);

    // Il vassoio non gira con la scatola: i pezzi presi escono dall'arena e
    // passano a un gruppo fermo, conservando la posa nel mondo (Object3D.attach).
    this.trayGroup = new THREE.Group();
    this.trayGroup.name = 'trayItems';
    this.scene.add(this.trayGroup);

    this.yaw = 0;        // rotazione della scatola attorno all'asse verticale
    this.spin = 0;       // velocità residua dopo il lancio
    this.dragging = false;

    this.items = [];       // tutti i pezzi del livello
    this.pile = [];        // pezzi ancora nella scatola (target del raycast)
    this.tray = new Tray(5);
    this.history = [];     // prese annullabili (azzerate a ogni match)

    this.physics = null;
    this.pendingSettle = false;
    this.clearing = 0;
    this.autoReshuffles = 0;
    this.settles = 0;

    this.raycaster = new THREE.Raycaster();
    // I bersagli del dito stanno sul layer 1 per non essere disegnati; senza
    // questa riga il raycaster, che di suo guarda solo il layer 0, non li vede.
    this.raycaster.layers.enable(1);
    this.pointer = new THREE.Vector2();
  }

  // ------------------------------------------------------------------ livello

  async startLevel(level) {
    this.level = level;
    this.state = State.LOADING;
    this.hud.setLoading(true);
    this.disposeLevel();

    const cfg = levelConfig(level);
    this.cfg = cfg;
    this.rng = new Rng(levelSeed(this.seed, level));

    this.setYaw(0);
    this.spin = 0;

    // Il mondo va dimensionato PRIMA della generazione: il grafo di occlusione
    // è costruito da questa esatta inquadratura.
    layoutWorld(this.scene, this.camera, this.camera.aspect, computeBoxSize(cfg.itemCount));

    // Due frame di respiro: il loader deve comparire prima della generazione,
    // che è sincrona e blocca il thread per qualche centinaio di ms.
    await nextFrame();
    await nextFrame();

    const data = await generateLevel(cfg, this.pileCamera(), this.rng);
    this.data = data;
    this.physics = data.physics;
    this.occlusion = data.occlusion;
    this.itemTypes = data.types;
    this.palette = data.palette;
    this.types = this.palette.map((m) => this.allTypes[m]);
    this.pickGeometries = this.palette.map((m) => this.allPickGeometries[m]);
    this.itemCount = cfg.itemCount;
    this.autoReshuffles = 0;
    this.settles = 0;

    this.boosters = { ...cfg.boosters };
    this.cleared = 0;
    this.total = data.active.length;

    for (const index of data.active) {
      this.items[index] = this.createItem(index, data.types[index]);
      this.pile.push(this.items[index]);
    }

    this.playback = { frames: data.frames, time: 0 };
    this.applyFrame(data.frames[0]);

    this.hud.setLevel(level);
    this.hud.setProgress(0, this.total);
    this.hud.setBoosters(this.boosters);
    this.hud.setLoading(false);
    this.state = State.DROPPING;
  }

  createItem(index, typeId) {
    const type = this.types[typeId];
    const mesh = new THREE.Mesh(type.geometry, type.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = true;
    this.group.add(mesh);

    const item = { index, type: typeId, mesh, pick: null, state: 'pile', home: null, tween: null };
    mesh.userData.item = item;

    // Bersaglio del dito: lo scafo convesso, invisibile, figlio della mesh —
    // così segue posizione e rotazione senza codice di sincronizzazione.
    // Il layer 1 lo tiene fuori dal rendering: la camera disegna solo il layer 0.
    const pick = new THREE.Mesh(this.pickGeometries[typeId]);
    pick.layers.set(1);
    pick.castShadow = false;
    pick.receiveShadow = false;
    pick.userData.item = item;
    mesh.add(pick);
    item.pick = pick;

    return item;
  }

  disposeLevel() {
    killAll();
    for (const item of this.items) if (item) this.trayGroup.remove(item.mesh);
    this.physics?.dispose();
    this.physics = null;
    this.pendingSettle = false;
    this.clearing = 0;
    for (const item of this.items) if (item) this.group.remove(item.mesh);
    this.items = [];
    this.pile = [];
    this.tray.clear();
    this.history = [];
    this.playback = null;
    this.hint = null;
  }

  // ---------------------------------------------------------------- rotazione

  setYaw(yaw) {
    this.yaw = yaw;
    this.arena.rotation.y = yaw;
  }

  beginRotate() {
    this.dragging = true;
    this.spin = 0;
    this.stopHint();
  }

  rotate(delta) {
    this.setYaw(this.yaw + delta);
  }

  /** Fine trascinamento: la scatola prosegue per inerzia. */
  endRotate(velocity = 0) {
    this.dragging = false;
    this.spin = Math.max(-7, Math.min(7, velocity));
    if (Math.abs(this.spin) < 0.15) {
      this.spin = 0;
      this.pendingSettle = true; // l'angolo è cambiato: il grafo va rifatto
    }
  }

  updateSpin(dt) {
    if (this.dragging || this.spin === 0) return;
    this.setYaw(this.yaw + this.spin * dt);
    this.spin *= Math.exp(-3.4 * dt);
    if (Math.abs(this.spin) < 0.15) {
      this.spin = 0;
      this.pendingSettle = true;
    }
  }

  /**
   * La camera vista dallo spazio della pila.
   * L'arena ruota di `yaw`, i corpi rigidi no: per proiettare le pose fisiche
   * sullo schermo basta ruotare la camera dell'angolo opposto.
   */
  pileCamera(yaw = this.yaw) {
    this._aux ??= this.camera.clone();
    this._aux.copy(this.camera);
    this._aux.applyMatrix4(new THREE.Matrix4().makeRotationY(-yaw));
    this._aux.updateMatrixWorld(true);
    return this._aux;
  }

  // ------------------------------------------------------------------- update

  update(dt) {
    this.updateSpin(dt);

    if (this.state === State.DROPPING) {
      this.updateDrop(dt);
      return;
    }
    if (!this.physics) return;

    // La pila è viva: finché qualcosa si muove le mesh seguono i corpi rigidi.
    const moving = this.physics.step(dt);
    if (moving) this.syncPile();

    // Il grafo si rifà solo a mondo fermo: pila assestata e scatola ferma.
    if (this.pendingSettle && !moving && !this.dragging && this.spin === 0) {
      this.pendingSettle = false;
      this.onSettled();
    }
  }

  /** Copia le pose dei corpi rigidi sulle mesh della pila. */
  syncPile() {
    const pose = this.physics.snapshot();
    for (const item of this.pile) {
      if (item.flying || !this.physics.bodies[item.index]) continue;
      const o = item.index * 7;
      item.mesh.position.set(pose[o], pose[o + 1], pose[o + 2]);
      item.mesh.quaternion.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
    }
  }

  /**
   * La frana ha cambiato la pila: il grafo di occlusione calcolato alla generazione
   * non vale più. Lo ricostruisco sulle pose nuove (pochi ms) e ricontrollo che il
   * livello sia ancora vincibile — è così che la garanzia sopravvive alla fisica.
   */
  onSettled() {
    this.settles++;
    if (this.state === State.WON || this.state === State.LOST) return;
    this.rebuildOcclusion();
    this.ensureSolvable();
  }

  rebuildOcclusion() {
    this.occlusion = this.occlusionAt(this.yaw);
  }

  /** Grafo di raggiungibilità con la scatola girata di `yaw`. */
  occlusionAt(yaw) {
    const occ = buildOcclusion(this.physics.snapshot(), this.itemCount, this.pileCamera(yaw));
    const inPile = new Set(this.pile.map((i) => i.index));
    const gone = [];
    for (let i = 0; i < this.itemCount; i++) if (!inPile.has(i)) gone.push(i);
    occ.setExcluded(gone);
    return occ;
  }

  /** Se la frana ha chiuso ogni strada, ridistribuisce i tipi invece di lasciarti bloccato. */
  ensureSolvable() {
    if (this.pile.length === 0) return;
    const tray = this.tray.types();
    const solvable = (occ) =>
      isSolvable(occ, this.itemTypes, { slots: this.tray.slots, tray, rng: this.rng, tries: 30 });

    if (solvable(this.occlusion)) return;

    // La scatola si può sempre girare: prima di dichiarare morta la posizione,
    // controllo se da un altro quarto di giro esiste una via d'uscita.
    const quarter = Math.PI / 2;
    for (const turn of [quarter, 2 * quarter, 3 * quarter]) {
      if (solvable(this.occlusionAt(this.yaw + turn))) return;
    }

    this.autoReshuffles++;
    this.applyTypes(
      reshuffleTypes(
        this.occlusion,
        this.pile.map((i) => i.index),
        this.itemTypes,
        this.tray.types(),
        this.cfg.spread * 0.5,
        this.rng
      )
    );
    this.hud.toast?.('Riassetto automatico');
  }

  updateDrop(dt) {
    const pb = this.playback;
    pb.time += dt * DROP_SPEED;

    const frame = Math.floor(pb.time * 60);
    if (frame >= pb.frames.length - 1) {
      this.applyFrame(this.data.poses);
      this.playback = null;
      this.state = State.PLAYING;
      return;
    }
    this.applyFrame(pb.frames[frame]);
  }

  applyFrame(frame) {
    for (const item of this.pile) {
      const o = item.index * 7;
      item.mesh.position.set(frame[o], frame[o + 1], frame[o + 2]);
      item.mesh.quaternion.set(frame[o + 3], frame[o + 4], frame[o + 5], frame[o + 6]);
    }
  }

  // -------------------------------------------------------------------- input

  pickAt(clientX, clientY, width, height) {
    if (this.state !== State.PLAYING || !this.tray.canAccept()) return null;

    const hits = this.castAtScreen(clientX, clientY, width, height);
    if (hits.length === 0) return null;

    this.take(hits[0].object.userData.item);
    return hits[0].object.userData.item;
  }

  /** Raycast da un punto dello schermo. */
  castAtScreen(clientX, clientY, width, height) {
    this.pointer.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.castAtPile();
  }

  /**
   * Raycast contro la pila, col raggio già impostato dal chiamante.
   *
   * Mira agli **scafi convessi**, non alle mesh disegnate. Il motivo è che
   * `normalize()` pareggia la *sfera* contenitiva, non l'area della silhouette:
   * un dado riempie la sua sfera, un paio di occhiali — che è per lo più vuoto —
   * ne occupa un settimo. Col raycast sulla mesh dettagliata il dito deve
   * infilare la montatura, e il raggio che passa nel buco fra le lenti prende il
   * pezzo dietro. Misurato sui livelli 3-10: gli occhiali si prendevano nel 28%
   * dei casi contro il 93% del dado; mirando allo scafo, 76% contro 87%.
   *
   * Lo scafo convesso è anche la forma con cui il pezzo si comporta davvero
   * nella pila — è il collider di Rapier — quindi il dito prende esattamente
   * l'ingombro che il giocatore vede spingere e franare.
   *
   * Aggiorna prima le matrici del grafo di scena: nel browser lo farebbe il
   * renderer, ma questo codice gira anche headless negli harness, dove nessuno
   * disegna nulla.
   */
  castAtPile() {
    this.arena.updateMatrixWorld(true);
    return this.raycaster.intersectObjects(this.pile.map((i) => i.pick), false);
  }

  take(item) {
    this.stopHint();

    const from = this.pile.indexOf(item);
    if (from < 0) return;
    this.pile.splice(from, 1);

    // Dove rimetterlo se il giocatore annulla: la posa di adesso, non quella
    // di fine caduta — nel frattempo la pila può essere franata più volte.
    item.home = {
      position: item.mesh.position.clone(),
      quaternion: item.mesh.quaternion.clone(),
    };

    this.occlusion.remove(item.index);
    this.physics.remove(item.index);   // sveglia i vicini: quelli sopra vengono giù
    this.pendingSettle = true;
    item.state = 'tray';

    // Esce dall'arena: da qui in poi la rotazione della scatola non lo tocca.
    this.trayGroup.attach(item.mesh);

    const { before, matched } = this.tray.insert(item);
    this.history.push(item);

    if (matched) {
      // Niente BUSY qui: il dito resta libero per tutto il pop.
      //
      // Si può perché il vassoio *logico* è già coerente — Tray.insert() ha
      // tolto i tre pezzi nell'istante in cui il match si è formato, quindi
      // canAccept() dice il vero mentre l'animazione va avanti. Il blocco era
      // solo dell'interfaccia, e ~0,7 s a ogni tripletta spezzavano il ritmo.
      this.clearing++;
      this.history = []; // l'undo non attraversa un match
      this.layout(before);
      this.flyToSlot(item, before.indexOf(item));

      tween({
        duration: CLEAR,
        delay: FLIGHT,
        ease: Ease.inCubic,
        onUpdate: (t) => {
          for (const m of matched) {
            m.mesh.scale.setScalar(TRAY.itemScale * (1 + t * 0.35 - t * t * 1.35));
            m.mesh.rotateY(0.14);
            m.mesh.position.y = traySlotPosition(0).y + t * 0.9;
          }
        },
        onComplete: () => this.finishMatch(matched),
      });
    } else {
      this.layout(this.tray.items);
      this.flyToSlot(item, this.tray.items.indexOf(item));

      // La sconfitta è decisa qui, non nella callback di un'animazione:
      // un tween ucciso o saltato non deve poter far sopravvivere il giocatore.
      if (this.tray.isFull) this.scheduleLoss();
    }
  }

  /** Blocca subito l'input; il verdetto aspetta che l'ultimo pezzo atterri. */
  scheduleLoss() {
    this.state = State.BUSY;
    tween({
      duration: 0.001,
      delay: FLIGHT,
      onUpdate: () => {},
      onComplete: () => {
        this.state = State.LOST;
        this.hud.showResult('lose', this.level);
      },
    });
  }

  finishMatch(matched) {
    for (const m of matched) {
      this.trayGroup.remove(m.mesh);
      m.state = 'cleared';
      this.items[m.index] = null;
    }
    this.cleared += matched.length;
    this.clearing--;
    this.hud.setProgress(this.cleared, this.total);
    this.layout(this.tray.items);

    // Il verdetto è già stato dato altrove: non tornare indietro.
    // Potendo prendere durante il pop, il giocatore può riempire il vassoio
    // mentre l'animazione va: la sconfitta scatta a FLIGHT, questa callback a
    // FLIGHT + CLEAR. Senza questa riga rimetterebbe PLAYING e lo
    // resusciterebbe da sconfitto.
    if (this.state === State.LOST || this.state === State.WON) return;

    // `clearing` conta i pop ancora in volo: con due triplette sovrapposte la
    // vittoria si dichiarerebbe mentre dei pezzi stanno ancora animando.
    if (this.pile.length === 0 && this.tray.size === 0 && this.clearing === 0) {
      this.state = State.WON;
      this.hud.showResult('win', this.level);
      return;
    }

    this.state = State.PLAYING;
  }

  // --------------------------------------------------------------- animazioni

  /** Dopo un cambio di inquadratura gli slot si spostano: riallinea il vassoio. */
  relayout() {
    for (const item of this.tray.items) {
      if (!item.flying) item.mesh.scale.setScalar(TRAY.itemScale);
    }
    this.layout(this.tray.items);
  }

  layout(list) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (item.state !== 'tray') continue;
      const target = traySlotPosition(i, this.tray.slots);
      if (item.mesh.position.distanceToSquared(target) < 1e-6) continue;
      if (item.flying) continue;
      this.slide(item, target);
    }
  }

  slide(item, target) {
    kill(item.tween);
    const start = item.mesh.position.clone();
    item.tween = tween({
      duration: 0.22,
      onUpdate: (t) => item.mesh.position.lerpVectors(start, target, t),
    });
  }

  flyToSlot(item, slotIndex) {
    kill(item.tween);
    const start = item.mesh.position.clone();
    const startQ = item.mesh.quaternion.clone();
    const target = traySlotPosition(Math.max(0, slotIndex), this.tray.slots);
    const lift = Math.max(1.6, start.distanceTo(target) * 0.35);
    const endQ = new THREE.Quaternion();
    const scale0 = item.mesh.scale.x;

    item.flying = true;
    item.tween = tween({
      duration: FLIGHT,
      ease: Ease.inOutQuad,
      onUpdate: (t) => {
        item.mesh.position.lerpVectors(start, target, t);
        item.mesh.position.y += Math.sin(Math.PI * t) * lift;
        item.mesh.quaternion.slerpQuaternions(startQ, endQ, t);
        const s = scale0 + (TRAY.itemScale - scale0) * t;
        item.mesh.scale.setScalar(s + Math.sin(Math.PI * t) * 0.12);
      },
      onComplete: () => {
        item.flying = false;
        item.mesh.scale.setScalar(TRAY.itemScale);
        if (this.state === State.PLAYING) this.layout(this.tray.items);
      },
    });
  }

  // ----------------------------------------------------------------- booster

  undo() {
    if (this.state !== State.PLAYING || this.boosters.undo <= 0) return false;
    const item = this.history.pop();
    if (!item) return false;

    this.boosters.undo--;
    this.stopHint();
    this.tray.remove(item);
    item.state = 'pile';
    this.pile.push(item);
    this.group.attach(item.mesh);   // torna nell'arena, e ricomincia a ruotare con essa

    // Rientra da poco sopra la sua vecchia posa: se nel frattempo il posto si è
    // riempito, ci cade sopra invece di comparirci dentro.
    const home = item.home.position.clone().setY(item.home.position.y + 0.3);

    kill(item.tween);
    const start = item.mesh.position.clone();
    const startQ = item.mesh.quaternion.clone();
    const scale0 = item.mesh.scale.x;
    item.flying = true;
    item.tween = tween({
      duration: FLIGHT,
      ease: Ease.inOutQuad,
      onUpdate: (t) => {
        item.mesh.position.lerpVectors(start, home, t);
        item.mesh.position.y += Math.sin(Math.PI * t) * 1.4;
        item.mesh.quaternion.slerpQuaternions(startQ, item.home.quaternion, t);
        item.mesh.scale.setScalar(scale0 + (1 - scale0) * t);
      },
      onComplete: () => {
        item.flying = false;
        item.mesh.scale.setScalar(1);
        this.physics.insert(item.index, home, item.home.quaternion);
        this.pendingSettle = true;
      },
    });

    this.layout(this.tray.items);
    this.hud.setBoosters(this.boosters);
    return true;
  }

  /** Miglior pezzo libero secondo la stessa politica del solver. */
  bestMove() {
    const free = this.occlusion.freeItems().filter((i) => this.items[i]?.state === 'pile');
    if (free.length === 0) return null;

    const freeByType = new Map();
    for (const i of free) {
      const t = this.itemTypes[i];
      freeByType.set(t, (freeByType.get(t) ?? 0) + 1);
    }

    const ranked = free
      .map((i) => {
        const t = this.itemTypes[i];
        const inTray = this.tray.countOf(t);
        let score;
        if (inTray === 2) score = 1000;
        else if (inTray === 1) score = 500 + (freeByType.get(t) ?? 0) * 10;
        else score = 100 + (freeByType.get(t) ?? 0) * 20 - this.tray.size * 15;
        return { i, score };
      })
      .sort((a, b) => b.score - a.score);

    // Fra mosse di pari valore preferisco quella che il dito prende al primo colpo:
    // il grafo approssima i pezzi con sfere, e per le forme sottili (coni, stelle)
    // può dirli liberi anche dove la mesh non c'è.
    // Solo spareggio, mai scavalcamento: la strategia resta quella validata dal solver.
    const top = ranked[0].score;
    for (const { i, score } of ranked) {
      if (score < top) break;
      if (this.isTappable(this.items[i])) return this.items[i];
    }
    return this.items[ranked[0].i];
  }

  /** Il pezzo è il primo colpito dal raycast puntando al suo centro? */
  isTappable(item) {
    if (!item) return false;
    this.arena.updateMatrixWorld(true);
    const world = item.mesh.getWorldPosition(new THREE.Vector3()).project(this.camera);
    this.pointer.set(world.x, world.y);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.castAtPile()[0]?.object.userData.item === item;
  }

  showHint() {
    if (this.state !== State.PLAYING || this.boosters.hint <= 0) return false;
    const item = this.bestMove();
    if (!item) return false;

    this.boosters.hint--;
    this.hud.setBoosters(this.boosters);
    this.stopHint();

    this.hint = {
      item,
      tween: tween({
        duration: 1.8,
        ease: Ease.linear,
        onUpdate: (t) => {
          const pulse = 1 + Math.abs(Math.sin(t * Math.PI * 4)) * 0.32;
          item.mesh.scale.setScalar(pulse);
        },
        onComplete: () => {
          item.mesh.scale.setScalar(1);
          this.hint = null;
        },
      }),
    };
    return true;
  }

  /**
   * Cambia identità ai pezzi della pila: rimpicciolisce, sostituisce, torna su.
   * Lo scambio avviene a metà animazione, quando i pezzi sono piccoli: mai ambiguo.
   */
  applyTypes(next) {
    const affected = this.pile.slice();

    tween({
      duration: 0.36,
      ease: Ease.inOutQuad,
      onUpdate: (t) => {
        const s = 1 - Math.sin(Math.PI * t) * 0.75;
        for (const item of affected) item.mesh.scale.setScalar(s);
      },
      onComplete: () => {
        for (const item of affected) item.mesh.scale.setScalar(1);
      },
    });

    tween({
      duration: 0.001,
      delay: 0.18,
      onUpdate: () => {},
      onComplete: () => {
        for (const item of affected) {
          const typeId = next[item.index];
          if (typeId < 0) continue;
          item.type = typeId;
          this.itemTypes[item.index] = typeId;
          item.mesh.geometry = this.types[typeId].geometry;
          item.mesh.material = this.types[typeId].material;
        }
        // Cambiata la forma, cambia il collider: la pila si riassesta di conseguenza.
        // Gli scafi vanno presi nella tavolozza del livello, non nell'elenco
        // completo: gli id dei tipi sono densi (0..K-1) e la tavolozza è la
        // sola cosa che li lega ai modelli veri.
        this.physics.setShapes(this.itemTypes, this.palette.map((m) => getHulls()[m]));
        this.pendingSettle = true;
      },
    });
  }

  stopHint() {
    if (!this.hint) return;
    kill(this.hint.tween);
    this.hint.item.mesh.scale.setScalar(1);
    this.hint = null;
  }

  shuffle() {
    if (this.state !== State.PLAYING || this.boosters.shuffle <= 0) return false;
    this.boosters.shuffle--;
    this.stopHint();

    this.applyTypes(
      reshuffleTypes(
        this.occlusion,
        this.pile.map((i) => i.index),
        this.itemTypes,
        this.tray.types(),
        this.cfg.spread,
        this.rng
      )
    );

    this.hud.setBoosters(this.boosters);
    return true;
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
