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
 * Misure e soglie stanno in model-stats.mjs, condivise con prepare-model:
 * due copie degli stessi numeri divergerebbero al primo ritocco.
 *
 * Licenza e leggibilità della silhouette non sono misurabili da qui.
 */
import { readStats, report } from './model-stats.mjs';

const file = process.argv[2];
if (!file) {
  console.error('uso: node scripts/check-model.mjs <file.glb>');
  process.exit(2);
}

const rows = report(await readStats(file));

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
