import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MODELS } from './models.generated.js';

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
 * Oggi quei tre filtri li applica `npm run check-model`, e l'elenco lo genera
 * `scripts/sync-models.mjs` scandendo public/models/: per aggiungere un oggetto
 * basta copiarci dentro il suo .glb.
 *
 * Le texture originali erano 2048² per 59 MB in tutto: ridotte a 256², che a
 * questa distanza è più del necessario. I .glb qui sono quelli ricomposti.
 */

export const ITEM_RADIUS = 0.44;

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

    // `gpuType` deve coincidere fra tutte le parti, altrimenti mergeGeometries
    // rinuncia e restituisce null. Non è un caso di scuola: basta un modello
    // con alcune mesh texturizzate e altre no — le UV vere arrivano dal
    // caricatore senza gpuType, quelle inventate qui sopra ce l'hanno.
    // Uniformarlo qui costa nulla e vale per qualunque modello si aggiunga.
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = geometry.attributes[name];
      if (attribute) attribute.gpuType = THREE.FloatType;
    }

    parts.push(geometry);
    materials.push(Array.isArray(node.material) ? node.material[0] : node.material);
  });

  if (parts.length === 0) throw new Error('modello senza mesh');
  if (parts.length === 1) return { geometry: parts[0], material: materials[0] };

  const geometry = mergeGeometries(parts, true);
  // Senza questo controllo il fallimento arriva molto più in là, come
  // «Cannot read properties of null» dentro normalize(), che non dice nulla su
  // quale modello sia il colpevole né perché.
  if (!geometry) {
    throw new Error(
      `impossibile fondere le ${parts.length} mesh del modello: attributi incompatibili`
    );
  }
  return { geometry, material: materials };
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
    const position = t.geometry.attributes.position;

    // Va letto con getX/getY/getZ, non da `.array`.
    //
    // Con un buffer *interleaved* — posizione, normale e UV alternate nello
    // stesso array — `.array` non contiene le sole posizioni: contiene tutto.
    // Uno scafo costruito così nasce da normali e coordinate UV scambiate per
    // punti nello spazio. Non è teoria: un modello scaricato aveva `count` 811
    // e `array.length` 6488, cioè 811 × 8 (3 + 3 + 2), e produceva un collider
    // che non somigliava alla forma — quando non faceva andare Rapier in panico.
    const out = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      out[i * 3] = position.getX(i) * k;
      out[i * 3 + 1] = position.getY(i) * k;
      out[i * 3 + 2] = position.getZ(i) * k;
    }
    return out;
  });
  return hulls;
}
