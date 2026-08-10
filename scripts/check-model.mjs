/**
 * Referto su un modello candidato.
 *
 *   node scripts/check-model.mjs <file.glb>
 *
 * I limiti vengono dal codice che carica i modelli (src/scene/shapes.js) e dai
 * vincoli di scena, non da regole generiche:
 *
 *  · le PROPORZIONI contano perché normalize() scala sulla *sfera* contenitiva:
 *    un oggetto lungo e piatto diventa minuscolo negli assi corti, si legge male
 *    e in un mucchio si comporta diversamente. È perché lanterna e pesce sono
 *    stati scartati (CREDITS.md).
 *  · i TRIANGOLI contano perché in scatola ce ne stanno fino a 60 insieme:
 *    ChronographWatch e ToyCar, 100.000 l'uno, sono stati scartati per questo
 *    prima che per l'estetica.
 *  · la SCALA invece non conta affatto: normalize() la rifà comunque.
 *
 * Licenza e leggibilità della silhouette non sono misurabili da qui.
 */
import { NodeIO } from '@gltf-transform/core';
import { statSync } from 'node:fs';

// Limiti tarati sui modelli che girano in produzione, non dedotti a tavolino.
// Misurati il 2026-08-10: AntiqueCamera 20.066 triangoli e proporzioni 2,78,
// Corset 18.324, SunglassesKhronos 13.396, WaterBottle 2,39, Avocado 2,28.
// Bocciare a 8.000 e a 2,0 avrebbe respinto metà del set che funziona da sempre.
const MAX_TRIANGLES = 25000;
const IDEAL_TRIANGLES = 8000;
const MAX_ASPECT = 2.8;   // il massimo che gira in produzione (AntiqueCamera 2,78)
const MAX_TEXTURE = 256;

// Il limite che mancava, e che sarebbe servito: un modello può passare tutto il
// resto e pesare 21 MB per via delle texture. Il set storico intero sta in
// 3,5 MB e il file più grosso è AntiqueCamera con 1,32 MB.
const MAX_BYTES = 1.5 * 1024 * 1024;

const file = process.argv[2];
if (!file) {
  console.error('uso: node scripts/check-model.mjs <file.glb>');
  process.exit(2);
}

const doc = await new NodeIO().read(file);
const root = doc.getRoot();

let triangles = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    triangles += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
  }
}
triangles = Math.round(triangles);

// Bounding box da tutte le posizioni: serve il rapporto fra i lati, non la scala.
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
      }
    }
  }
}
const sides = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map(Math.abs);
const aspect = Math.max(...sides) / Math.max(1e-9, Math.min(...sides));

const textures = root.listTextures().map((t) => {
  const size = t.getSize();
  return { w: size?.[0] ?? 0, h: size?.[1] ?? 0 };
});
const biggest = textures.reduce((m, t) => Math.max(m, t.w, t.h), 0);
const hasUV = root
  .listMeshes()
  .some((m) => m.listPrimitives().some((p) => p.getAttribute('TEXCOORD_0')));
const bytes = statSync(file).size;

const rows = [
  ['triangoli', triangles.toLocaleString('it'), triangles <= MAX_TRIANGLES,
    triangles <= IDEAL_TRIANGLES ? 'ideale' : `limite ${MAX_TRIANGLES.toLocaleString('it')}`],
  ['proporzioni', aspect.toFixed(2), aspect <= MAX_ASPECT, `lungo/corto ≤ ${MAX_ASPECT}`],
  ['texture max', biggest ? `${biggest}px` : 'nessuna', biggest <= MAX_TEXTURE, `≤ ${MAX_TEXTURE}px`],
  ['UV', hasUV ? 'sì' : 'no', hasUV || textures.length === 0, 'servono se ci sono texture'],
  ['materiali', String(root.listMaterials().length), true, "più di uno va bene: flatten() li fonde"],
  ['peso', `${(bytes / 1024).toFixed(0)} KB`, bytes <= MAX_BYTES, `≤ ${(MAX_BYTES / 1024 / 1024).toFixed(1)} MB`],
];

console.log(`\n${file}\n`);
for (const [label, value, ok, note] of rows) {
  console.log(`  ${ok ? '✓' : '✗'}  ${label.padEnd(13)} ${String(value).padEnd(12)} ${note}`);
}

console.log('\n  Non verificabili da qui, guardali tu:');
console.log('  · licenza — CC0 o CC BY, senza logo né marchi');
console.log('  · silhouette e colore distinti dai tipi già in gioco\n');

const failed = rows.filter(([, , ok]) => !ok);
if (failed.length) {
  console.error(`Non passa: ${failed.map(([l]) => l).join(', ')}. Prova con prepare-model.`);
  process.exit(1);
}
console.log('Passa i requisiti misurabili.');
