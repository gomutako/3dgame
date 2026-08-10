/**
 * Misure e limiti di un modello, in un posto solo.
 *
 * Li usano sia `check-model` (che dà il verdetto) sia `prepare-model` (che
 * decide quanto decimare): due copie degli stessi numeri divergerebbero al
 * primo ritocco.
 *
 * I limiti sono tarati sui modelli che girano in produzione, non dedotti a
 * tavolino. Misurati il 2026-08-10: AntiqueCamera 20.066 triangoli e
 * proporzioni 2,78, Corset 18.324, SunglassesKhronos 13.396, WaterBottle 2,39,
 * Avocado 2,28. Bocciare a 8.000 triangoli e a 2,0 di proporzioni — i numeri
 * che si deducono da CREDITS.md — avrebbe respinto metà del set che funziona
 * da sempre.
 */
import { NodeIO, Logger } from '@gltf-transform/core';
import { statSync } from 'node:fs';

export const LIMITS = {
  maxTriangles: 25000,
  idealTriangles: 8000,
  maxAspect: 2.8,      // il massimo che gira in produzione (AntiqueCamera 2,78)
  maxTexture: 256,     // a questa distanza è già più del necessario
  // Il limite che mancava, e che sarebbe servito: un modello può passare tutto
  // il resto e pesare 21 MB per via delle texture. Il set storico intero sta in
  // 3,5 MB e il file più grosso è AntiqueCamera con 1,32 MB.
  maxBytes: 1.5 * 1024 * 1024,
};

export async function readStats(file) {
  // Senza, ogni lettura stampa un avviso per ogni estensione glTF non
  // registrata: rumore a ogni `npm run dev`, e nessuna di quelle estensioni
  // serve alle misure.
  const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR));
  const doc = await io.read(file);
  const root = doc.getRoot();

  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      triangles += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  }

  // Bounding box da tutte le posizioni: serve il rapporto fra i lati, non la
  // scala — normalize() la rifà comunque.
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
  const aspect = sides.every(Number.isFinite)
    ? Math.max(...sides) / Math.max(1e-9, Math.min(...sides))
    : Infinity;

  const textures = root.listTextures().map((t) => t.getSize() ?? [0, 0]);
  const biggestTexture = textures.reduce((m, [w, h]) => Math.max(m, w, h), 0);

  return {
    triangles: Math.round(triangles),
    aspect,
    biggestTexture,
    textureCount: textures.length,
    materials: root.listMaterials().length,
    hasUV: root.listMeshes().some((m) =>
      m.listPrimitives().some((p) => p.getAttribute('TEXCOORD_0'))
    ),
    bytes: statSync(file).size,
  };
}

/** Le righe del referto: [etichetta, valore, passa, nota]. */
export function report(stats) {
  const L = LIMITS;
  return [
    ['triangoli', stats.triangles.toLocaleString('it'), stats.triangles <= L.maxTriangles,
      stats.triangles <= L.idealTriangles ? 'ideale' : `limite ${L.maxTriangles.toLocaleString('it')}`],
    ['proporzioni', stats.aspect.toFixed(2), stats.aspect <= L.maxAspect, `lungo/corto ≤ ${L.maxAspect}`],
    ['texture max', stats.biggestTexture ? `${stats.biggestTexture}px` : 'nessuna',
      stats.biggestTexture <= L.maxTexture, `≤ ${L.maxTexture}px`],
    ['UV', stats.hasUV ? 'sì' : 'no', stats.hasUV || stats.textureCount === 0,
      'servono se ci sono texture'],
    ['materiali', String(stats.materials), true, 'più di uno va bene: flatten() li fonde'],
    ['peso', `${(stats.bytes / 1024).toFixed(0)} KB`, stats.bytes <= L.maxBytes,
      `≤ ${(L.maxBytes / 1024 / 1024).toFixed(1)} MB`],
  ];
}
