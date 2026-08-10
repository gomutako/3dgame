import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ITEM_RADIUS } from './shapes.js';

/** Passo della griglia di spawn: un pezzo più un filo d'aria. */
export const CELL = ITEM_RADIUS * 2 + 0.12;

/** Geometria del mondo, condivisa fra render e simulazione fisica. */
export const BOX = {
  size: 5.6,        // lato interno (ricalcolato a ogni livello)
  floorY: 0,        // quota del fondo
  wallHeight: 9,    // muri fisici (invisibili, contengono la caduta)
  rim: 1.35,        // altezza dei bordi visibili
};

const MARGIN = 0.25; // aria fra l'ultima colonna e la parete

/** Colonne di spawn che entrano in una scatola di lato `size`. */
export function spawnColumns(size) {
  return Math.max(2, Math.floor((size - MARGIN) / CELL));
}

/** Area che un pezzo occupa a terra una volta posato. Misurata, non stimata. */
const ITEM_FOOTPRINT = 0.62;

/**
 * La scatola si stringe o si allarga per tenere la pila sui ~3 strati:
 * la sovrapposizione è la sostanza del puzzle, non un effetto scenico.
 * Senza di essa il grafo di occlusione non avrebbe nulla da dire.
 *
 * Il conto è sull'area davvero occupata, non su una griglia teorica: con forme
 * reali i pezzi si incastrano e in uno strato ce ne stanno molti più di quanti
 * ne preveda una scacchiera, e la pila verrebbe piatta.
 */
export function computeBoxSize(itemCount, layers = 3) {
  const side = Math.sqrt((itemCount * ITEM_FOOTPRINT) / layers);
  return Math.min(6, Math.max(3, side + MARGIN));
}

export const TRAY = {
  slots: 5,
  z: 5.15,        // ricalcolato con la scatola: resta appena davanti al bordo
  y: 0.62,
  spacing: 1.18,  // ricalcolato dall'inquadratura
  itemScale: 1,   // in verticale 5 pezzi a grandezza naturale non ci starebbero
};

const trayGap = 2.35;
const PILE_TOP = 3.3; // quota che la pila raggiunge con ~3 strati: va inquadrata

export function traySlotPosition(index, count = TRAY.slots) {
  const x = (index - (count - 1) / 2) * TRAY.spacing;
  return new THREE.Vector3(x, TRAY.y, TRAY.z);
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Neutral (Khronos PBR Neutral) invece di ACES: ACES desatura le tinte piene,
  // e questi modelli hanno il colore cotto nei vertici — va reso com'è.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer;
}

export function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a0f1c');

  // Ambiente PMREM: riflessi morbidi sui materiali, zero costo a runtime.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight('#9fc4ff', '#1b2340', 0.45));

  const key = new THREE.DirectionalLight('#ffffff', 2.6);
  key.position.set(2.6, 12.5, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  const half = BOX.size * 0.75 + 3;
  Object.assign(key.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#6ea8ff', 0.55);
  fill.position.set(-6, 4, -4);
  scene.add(fill);

  // L'arena è ciò che ruota sotto il dito: scatola e pila insieme.
  // Vassoio, luci e camera restano fermi, così il vassoio non esce mai di scena.
  const arena = new THREE.Group();
  arena.name = 'arena';
  scene.add(arena);

  return scene;
}

/**
 * Il gruppo che ruota. Le mesh dei pezzi vanno agganciate qui, non alla scena.
 * Lo crea se manca, così funziona anche sulle scene nude degli harness headless.
 */
export function getArena(scene) {
  let arena = scene.getObjectByName('arena');
  if (!arena) {
    arena = new THREE.Group();
    arena.name = 'arena';
    scene.add(arena);
  }
  return arena;
}

/**
 * Unico punto d'ingresso per il layout del mondo, e va nell'ordine:
 * misure → camera → passo del vassoio (che dipende dall'inquadratura) → mesh.
 * Da chiamare PRIMA di generare il livello: il grafo di occlusione nasce
 * da questa camera.
 */
export function layoutWorld(scene, camera, aspect, size = BOX.size) {
  BOX.size = size;
  TRAY.z = size / 2 + trayGap;

  frameCamera(camera, aspect, size);
  TRAY.spacing = fitTraySpacing(camera, aspect);
  TRAY.itemScale = Math.min(1, TRAY.spacing / (ITEM_RADIUS * 2 + 0.14));

  const arena = getArena(scene);
  for (const [parent, name] of [[arena, 'box'], [scene, 'tray']]) {
    const previous = parent.getObjectByName(name);
    if (previous) {
      parent.remove(previous);
      previous.traverse((o) => o.geometry?.dispose());
    }
  }
  arena.add(buildBox(size));
  scene.add(buildTrayPads());
}

/** Il vassoio non deve mai uscire dallo schermo: il passo si adatta all'inquadratura. */
function fitTraySpacing(camera, aspect) {
  const view = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const toTray = new THREE.Vector3(0, TRAY.y, TRAY.z).sub(camera.position);
  const depth = Math.max(1, toTray.dot(view));
  const halfWidth = Math.tan((camera.fov * Math.PI) / 360) * depth * aspect;
  return Math.min(1.18, (halfWidth * 1.84) / TRAY.slots);
}

function buildBox(s) {
  const group = new THREE.Group();
  group.name = 'box';

  const floorMat = new THREE.MeshStandardMaterial({ color: '#1d2742', roughness: 0.85, metalness: 0.05 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(s + 0.5, 0.4, s + 0.5), floorMat);
  floor.position.y = BOX.floorY - 0.2;
  floor.receiveShadow = true;
  group.add(floor);

  // Bordi bassi: contengono lo sguardo senza nascondere la pila.
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: '#5f7dc4',
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.22,
  });
  const t = 0.16;
  const rimGeoX = new THREE.BoxGeometry(s + 0.5, BOX.rim, t);
  const rimGeoZ = new THREE.BoxGeometry(t, BOX.rim, s + 0.5);
  const y = BOX.floorY + BOX.rim / 2;
  for (const [geo, x, z] of [
    [rimGeoX, 0, -(s / 2 + t / 2)],
    [rimGeoX, 0, s / 2 + t / 2],
    [rimGeoZ, -(s / 2 + t / 2), 0],
    [rimGeoZ, s / 2 + t / 2, 0],
  ]) {
    const wall = new THREE.Mesh(geo, rimMat);
    wall.position.set(x, y, z);
    group.add(wall);
  }

  // Piano d'appoggio esteso: raccoglie l'ombra e dà profondità alla scena.
  const stage = new THREE.Mesh(
    new THREE.CircleGeometry(16, 48),
    new THREE.MeshStandardMaterial({ color: '#0d1428', roughness: 1 })
  );
  stage.rotation.x = -Math.PI / 2;
  stage.position.y = BOX.floorY - 0.42;
  stage.receiveShadow = true;
  group.add(stage);

  return group;
}

function buildTrayPads() {
  const group = new THREE.Group();
  group.name = 'tray';

  const padMat = new THREE.MeshPhysicalMaterial({
    color: '#33447a',
    roughness: 0.35,
    metalness: 0.15,
    transparent: true,
    opacity: 0.6,
  });

  const r = TRAY.spacing * 0.44;
  for (let i = 0; i < TRAY.slots; i++) {
    const p = traySlotPosition(i);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.14, 32), padMat);
    pad.position.set(p.x, p.y - ITEM_RADIUS * TRAY.itemScale - 0.12, p.z);
    pad.receiveShadow = true;
    group.add(pad);
  }
  return group;
}

export function createCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.5, 100);
  frameCamera(camera, aspect);
  return camera;
}

/**
 * Inquadra scatola + vassoio in un colpo solo.
 * In verticale la camera arretra (su iPhone il campo utile è stretto in larghezza)
 * e si avvicina quando la scatola è piccola, così i primi livelli non sembrano lontani.
 *
 * Il grafo di occlusione nasce da questa camera: va chiamata PRIMA di generare.
 */
export function frameCamera(camera, aspect, size = BOX.size) {
  camera.aspect = aspect;

  // La scatola gira: quello che deve stare in quadro non è il quadrato fermo ma
  // il cilindro che lo contiene a qualunque angolo — raggio = mezza diagonale.
  const r = (size / 2) * Math.SQRT2;
  const target = new THREE.Vector3(0, 0.9, size * 0.34);
  const direction = new THREE.Vector3(0, 0.686, 0.729).normalize(); // inclinazione fissa

  // Punti che devono restare inquadrati, con il loro margine massimo in NDC.
  // Il vassoio ha un limite più stretto: sotto di lui ci vanno i pulsanti.
  const anchors = [
    { p: new THREE.Vector3(r, PILE_TOP, 0), limit: 0.88 },
    { p: new THREE.Vector3(-r, PILE_TOP, 0), limit: 0.88 },
    { p: new THREE.Vector3(0, PILE_TOP, -r), limit: 0.88 },
    { p: new THREE.Vector3(0, 0, r), limit: 0.88 },
    { p: new THREE.Vector3(0, 0, TRAY.z + 0.6), limit: 0.7 },
  ];

  // La dimensione proiettata va come 1/distanza: poche iterazioni bastano.
  let distance = 12;
  const v = new THREE.Vector3();
  for (let i = 0; i < 12; i++) {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    let worst = 0;
    for (const { p, limit } of anchors) {
      v.copy(p).project(camera);
      worst = Math.max(worst, Math.abs(v.x) / limit, Math.abs(v.y) / limit);
    }
    if (worst > 0.985 && worst < 1.015) break;
    distance *= worst;
  }
}
