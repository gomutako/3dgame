/**
 * Porta in specifica un modello scaricato dal web.
 *
 *   node scripts/prepare-model.mjs <file.obj|file.glb> [nome]
 *
 * I modelli in rete arrivano quasi sempre fuori specifica di uno o due ordini
 * di grandezza. Casi reali, misurati il 2026-08-10 in questa cartella:
 * `Rubik.glb` con 98.550 triangoli (con 60 pezzi in scatola sono 5,9 milioni
 * per fotogramma) e `strawberry_LP.glb` da 21,8 MB per via di texture 2048².
 *
 * La pipeline converte, decima e riduce, poi passa la parola a check-model.
 *
 * Blender non serve: tutto da riga di comando. Chi ce l'ha può esportare .glb
 * per conto suo e passare direttamente a check-model.
 *
 * ⚠️ Un .obj ha bisogno del suo .mtl e delle texture NELLA STESSA CARTELLA:
 * i riferimenti dentro il file sono relativi.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { readStats, LIMITS } from './model-stats.mjs';

const input = process.argv[2];
if (!input) {
  console.error('uso: node scripts/prepare-model.mjs <file.obj|file.glb> [nome]');
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`file non trovato: ${input}`);
  process.exit(2);
}

const name = process.argv[3] || basename(input, extname(input));
const work = mkdtempSync(join(tmpdir(), 'prep-'));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
const gltf = (...args) => run('npx', ['--yes', 'gltf-transform', ...args]);

const show = (label, s) =>
  console.log(
    `  ${label.padEnd(9)} ${String(s.triangles).padStart(7)} triangoli  ` +
    `${String(s.biggestTexture || '—').padStart(5)}px  ${(s.bytes / 1024).toFixed(0).padStart(6)} KB`
  );

console.log(`\nsorgente: ${input}`);

// 1 · in glTF binario
let current = join(work, 'a.glb');
if (extname(input).toLowerCase() === '.obj') {
  console.log('\n· conversione da OBJ');
  run('npx', ['--yes', 'obj2gltf', '-i', input, '-o', current, '--binary']);
} else {
  copyFileSync(input, current);
}

const before = await readStats(current);
console.log();
show('prima', before);

// 2 · saldatura dei vertici duplicati: senza, la decimazione lavora su una
//     mesh frammentata e il risultato si sbriciola invece di semplificarsi.
let next = join(work, 'b.glb');
gltf('weld', current, next);
current = next;

// 3 · decimazione, solo se serve e con il rapporto ricavato dal conteggio vero
//     invece che da una costante: un modello già leggero non va toccato.
const counted = await readStats(current);
if (counted.triangles > LIMITS.idealTriangles) {
  const ratio = Math.max(0.01, LIMITS.idealTriangles / counted.triangles);
  console.log(`\n· decimazione (rapporto ${ratio.toFixed(3)})`);
  next = join(work, 'c.glb');
  gltf('simplify', current, next, '--ratio', String(ratio), '--error', '0.005');
  current = next;
}

// 4 · texture a 256²
if (counted.biggestTexture > LIMITS.maxTexture) {
  console.log('\n· riduzione delle texture');
  next = join(work, 'd.glb');
  gltf('resize', current, next, '--width', String(LIMITS.maxTexture), '--height', String(LIMITS.maxTexture));
  current = next;
}

// 5 · via ciò che il gioco non usa
console.log('\n· pulizia');
next = join(work, 'e.glb');
gltf('prune', current, next);
current = next;

mkdirSync('public/models', { recursive: true });
const out = join('public', 'models', `${name}.glb`);
copyFileSync(current, out);

const after = await readStats(out);
show('dopo', after);
console.log(`\nscritto: ${out}\n`);

// 6 · il verdetto lo dà check-model: i limiti stanno in un posto solo
try {
  execFileSync('node', ['scripts/check-model.mjs', out], { stdio: 'inherit' });
} catch {
  console.error('\nIl modello non rientra ancora nei limiti. Se è la geometria a');
  console.error('non scendere, spesso il modello è irrecuperabile: cercarne un altro');
  console.error('costa meno che insistere. Se sono le proporzioni, non c\'è pipeline');
  console.error('che tenga — un oggetto lungo e piatto resta lungo e piatto.');
  process.exit(1);
}
