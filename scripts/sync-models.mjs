/**
 * Genera src/scene/models.generated.js scandendo public/models/.
 *
 * Perché un file generato e non `import.meta.glob`: quest'ultimo è una
 * trasformazione di Vite, ma shapes.js viene importato anche da
 * scripts/headless.mjs, che gira in Node puro per le verifiche. Un modulo
 * generato lo leggono entrambi.
 *
 * Gira da solo prima di `dev`, `build` e delle verifiche: per aggiungere un
 * oggetto al gioco basta copiare il suo .glb nella cartella.
 *
 * ⚠️ Entrano solo i modelli che passano check-model. Un file fuori specifica
 * non deve arrivare in partita per il solo fatto di essere stato scaricato:
 * 98.000 triangoli moltiplicati per 60 pezzi in scatola, o un oggetto lungo e
 * piatto che normalize() riduce a un fuscello, rovinano il livello in silenzio.
 * Chi viene escluso lo si sistema con `npm run prepare-model`.
 */
import { readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readStats, report } from './model-stats.mjs';

const MODELS_DIR = fileURLToPath(new URL('../public/models/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/scene/models.generated.js', import.meta.url));

// Nomi italiani dei modelli storici: dal nome del file non si deducono.
const KNOWN = {
  Avocado: 'avocado',
  BoomBox: 'stereo',
  WaterBottle: 'borraccia',
  AntiqueCamera: 'macchina fotografica',
  Corset: 'corsetto',
  SunglassesKhronos: 'occhiali da sole',
  Dice: 'dado',
  Rubik: 'cubo di Rubik',
  basketball: 'pallone',
  blackberry: 'mora',
  strawberry_LP: 'fragola',
};

/** "RedStrawberry" o "red_strawberry_LP" → "red strawberry". */
function readable(file) {
  return file
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\bLP\b/gi, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const files = readdirSync(MODELS_DIR)
  .filter((f) => f.toLowerCase().endsWith('.glb'))
  .map((f) => f.slice(0, -4))
  .sort();

const accepted = [];
const rejected = [];

for (const file of files) {
  const rows = report(await readStats(join(MODELS_DIR, `${file}.glb`)));
  const bad = rows.filter(([, , ok]) => !ok).map(([label]) => label);
  if (bad.length) rejected.push({ file, why: bad.join(', ') });
  else accepted.push({ file, name: KNOWN[file] ?? readable(file) });
}

for (const { file, why } of rejected) {
  console.warn(`escluso  ${file}: ${why} — sistemalo con: npm run prepare-model public/models/${file}.glb`);
}

if (accepted.length < 3) {
  console.error(
    `Solo ${accepted.length} modelli validi in public/models/: il livello più facile ne usa 3.`
  );
  process.exit(1);
}

const body = `// GENERATO da scripts/sync-models.mjs — non modificare a mano.
// Si rigenera prima di dev, build e verifiche: per aggiungere un oggetto basta
// copiare il suo .glb in public/models/. Entrano solo quelli che passano
// check-model.
export const MODELS = [
${accepted.map((e) => `  { file: '${e.file}', name: '${e.name}' },`).join('\n')}
];
`;

const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (before !== body) {
  writeFileSync(OUT, body);
  console.log(`models.generated.js: ${accepted.length} modelli`);
}
