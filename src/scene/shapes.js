import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * I tipi di oggetto: modelli con texture PBR dipinte (colore, normali, metallo,
 * ruvidità), dai campioni glTF di Khronos — vedi CREDITS.md per licenze e autori.
 *
 * La scelta è passata da tre filtri, non dal gusto:
 *  · licenza — scartati DamagedHelmet (CC BY-NC: vieta l'uso commerciale) e
 *    Duck (licenza Sony proprietaria)
 *  · forma — solo oggetti compatti; una lanterna o un pesce, lunghi e piatti,
 *    in un mucchio si comportano e si leggono in modo troppo diverso
 *  · peso in scena — scartati ChronographWatch e ToyCar: 100.000 triangoli
 *    l'uno fanno 6 milioni di triangoli con 60 pezzi in scatola
 *
 * Le texture originali erano 2048² per 59 MB in tutto: ridotte a 256², che a
 * questa distanza è più del necessario. I .glb qui sono quelli ricomposti.
 */

export const ITEM_RADIUS = 0.44;

// L'ordine conta: un livello usa i primi N tipi, quindi in testa vanno quelli
// che si distinguono di più a colpo d'occhio.
const MODELS = [
  { file: 'Avocado', name: 'avocado' },
  { file: 'BoomBox', name: 'stereo' },
  { file: 'WaterBottle', name: 'borraccia' },
  { file: 'AntiqueCamera', name: 'macchina fotografica' },
  { file: 'Corset', name: 'corsetto' },
  { file: 'SunglassesKhronos', name: 'occhiali da sole' },
];

export const TYPE_COUNT = MODELS.length;

let types = null;
let hulls = null;

/**
 * Carica i modelli. Va attesa prima di costruire il gioco.
 * @param {string} base cartella dei .glb
 */
export async function loadItemTypes(base = '/models/') {
  if (types) return types;

  const loader = new GLTFLoader();
  const loaded = await Promise.all(MODELS.map((m) => loader.loadAsync(`${base}${m.file}.glb`)));

  types = loaded.map((gltf, id) => {
    const { geometry, material } = flatten(gltf.scene);
    return { id, name: MODELS[id].name, geometry: normalize(geometry), material };
  });
  return types;
}

export function getItemTypes() {
  if (!types) throw new Error('loadItemTypes() va attesa prima di usare i tipi');
  return types;
}

/**
 * Fonde le mesh del modello in una sola geometria, tenendo i materiali.
 * Un pezzo = una mesh sola: meno oggetti da disegnare con sessanta in scatola.
 * I materiali diventano un array e la geometria porta un gruppo per ciascuno.
 */
function flatten(root) {
  root.updateMatrixWorld(true);

  const parts = [];
  const materials = [];
  root.traverse((node) => {
    if (!node.isMesh) return;
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);

    // Tiene solo ciò che serve: attributi diversi impedirebbero la fusione.
    // Le UV restano — sono ciò che pesca il colore dalla texture.
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') {
        geometry.deleteAttribute(name);
      }
    }
    if (!geometry.attributes.uv) {
      const n = geometry.attributes.position.count;
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    parts.push(geometry);
    materials.push(Array.isArray(node.material) ? node.material[0] : node.material);
  });

  if (parts.length === 0) throw new Error('modello senza mesh');
  if (parts.length === 1) return { geometry: parts[0], material: materials[0] };
  return { geometry: mergeGeometries(parts, true), material: materials };
}

/** Centra la geometria e la scala perché la sfera contenitiva sia ITEM_RADIUS. */
function normalize(geometry) {
  geometry.center();
  geometry.computeBoundingSphere();
  const s = ITEM_RADIUS / geometry.boundingSphere.radius;
  geometry.scale(s, s, s);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Punti per lo scafo convesso di ogni tipo, per i collider della fisica.
 *
 * Lo scafo convesso è l'approssimazione giusta qui: riproduce fedelmente coni,
 * bulbi e cilindri — cioè i casi in cui un collider a scatola faceva restare i
 * pezzi appollaiati sul nulla. Perde le concavità (il manico della tazza), che
 * nessuno percepisce dentro un mucchio.
 */
export function getHulls(skin = 0.035) {
  if (hulls) return hulls;

  // I punti sono rimpiccioliti del margine con cui la fisica li ri-gonfierà
  // (scafo arrotondato): così l'ingombro fisico coincide con la forma disegnata.
  const k = (ITEM_RADIUS - skin) / ITEM_RADIUS;
  hulls = getItemTypes().map((t) => {
    const src = t.geometry.attributes.position.array;
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] * k;
    return out;
  });
  return hulls;
}
