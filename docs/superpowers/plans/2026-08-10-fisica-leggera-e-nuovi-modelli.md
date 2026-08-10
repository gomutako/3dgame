# Fisica più leggera e strumenti per i modelli — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rendere la caduta «terrestre e vivace» senza distruggere il puzzle, e dare all'utente due comandi per portare in specifica i modelli che trova sul web.

**Architecture:** le costanti di simulazione stanno tutte in `src/level/physics.js`; si cambiano solo dopo aver strumentato le due grandezze che possono peggiorare (frame di assestamento e frazione di pezzi occlusi), estendendo `scripts/verify-physics.mjs` che è già in CI. Gli strumenti per i modelli sono due script Node autonomi che si appoggiano a `@gltf-transform` e `obj2gltf`, senza toccare il codice di gioco.

**Tech Stack:** Rapier (`@dimforge/rapier3d-compat`), three.js, Node 22, `@gltf-transform/core` + CLI, `obj2gltf`.

**Spec di riferimento:** [`docs/superpowers/specs/2026-08-10-fisica-leggera-e-nuovi-modelli-design.md`](../specs/2026-08-10-fisica-leggera-e-nuovi-modelli-design.md)

## Global Constraints

- Obiettivo di sensazione: **terrestre e vivace**.
- **Soglia di rifiuto: occlusione media sotto il 25%.** Se le costanti nuove la fanno scendere sotto, vanno corrette — l'attrito è la leva che la governa di più, la gravità la seconda.
- Le quattro suite di `npm run verify` devono restare verdi: `verify:levels` (ogni livello risolvibile), `verify:play` (un giocatore automatico li completa), `verify:boosters`, `verify:physics` (nessun pezzo sotto il piano).
- **La massa non va toccata:** in un corpo rigido non cambia la velocità di caduta. Chi propone di abbassare la densità ha capito male il problema.
- Non alzare `TYPE_COUNT`, non toccare `src/core/levels.js`, non rifare i sei `.glb` già in `public/models/`.
- Lingua di commenti, documentazione e commit: **italiano**.
- Branch di lavoro `develop`; la produzione è `master` via pull request.

## File Structure

| File | Stato | Responsabilità |
|---|---|---|
| `scripts/verify-physics.mjs` | modificare | aggiunge due metriche (assestamento, occlusione) al controllo che ha già |
| `src/level/physics.js` | modificare | gravità, `restitution`, damping, `friction`, `DROP_STEPS` |
| `scripts/check-model.mjs` | creare | referto su un `.glb`, verdetto passa/non passa |
| `scripts/prepare-model.mjs` | creare | conversione + decimazione + riduzione texture, poi referto |
| `package.json` | modificare | script `check-model`, `prepare-model`; dipendenze di sviluppo |
| `DESIGN.md` | modificare | §3 e §5: costanti nuove, e il residuo dei «12 modelli» |
| `README.md` | modificare | i due comandi nuovi |

---

### Task 1: Strumentare le due metriche e registrare il baseline

Senza numeri di partenza non si può dire se i valori nuovi peggiorano qualcosa. Questa task **non cambia la fisica**: aggiunge le misure e fotografa lo stato attuale.

**Files:**
- Modify: `scripts/verify-physics.mjs`

**Interfaces:**
- Consumes: `game.physics.asleep()`, `game.physics.bodies`, `game.occlusion.freeItems()`, `game.pile`, `game.bestMove()`, `game.take(item)` — tutti già usati dallo script oggi.
- Produces: un tabulato con le colonne `assestamento med/max` (frame) e `occlusi %`, e le due medie complessive stampate in fondo. La Task 2 confronta contro questi numeri.

- [ ] **Step 1: Aggiungere la raccolta delle due metriche**

In `scripts/verify-physics.mjs`, dentro il ciclo delle prese, sostituire il blocco che oggi misura solo `lowest`/`minY`/`sunk` con questo, che misura anche i frame di assestamento e l'occlusione:

```js
    const lowest = new Map();
    let frames = 0;
    for (let k = 0; k < 400; k++) {
      step();
      frames++;
      game.physics.bodies.forEach((b, i) => {
        if (!b) return;
        const y = b.translation().y;
        lowest.set(i, Math.min(lowest.get(i) ?? Infinity, y));
        if (y < minY) minY = y;
        if (y < BOX.floorY) sunk++;
      });
      if (game.physics.asleep()) break;
    }
    settleFrames.push(frames);

    // Occlusione: quanti pezzi NON sono cliccabili a pila ferma. È la grandezza
    // che fa il puzzle — una pila che si sparpaglia è più bella e meno gioco.
    // Il grafo è già stato ricostruito da onSettled(), che scatta a pila ferma.
    if (game.pile.length > 0) {
      const free = game.occlusion.freeItems().filter((i) => game.items[i]?.state === 'pile').length;
      occluded.push(1 - free / game.pile.length);
    }
```

- [ ] **Step 2: Dichiarare gli accumulatori e stampare le colonne**

Sempre in `scripts/verify-physics.mjs`, accanto a `let minY = Infinity;` aggiungere:

```js
  const settleFrames = [];
  const occluded = [];
```

Sostituire l'intestazione della tabella con:

```js
console.log('lvl  prese  minY   sotto  discesa  assest.med  assest.max  occlusi%');
console.log('─'.repeat(74));
```

e la riga per livello con:

```js
  const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);
  const occMean = occluded.length ? occluded.reduce((s, v) => s + v, 0) / occluded.length : 0;
  allOccluded.push(...occluded);
  allSettle.push(...settleFrames);

  const bad = sunk > 0;
  if (bad) failures++;
  console.log(
    `${String(level).padStart(3)}  ${String(picks).padStart(5)}  ` +
    `${minY.toFixed(2).padStart(5)}  ${String(sunk).padStart(5)}  ${maxDip.toFixed(3).padStart(7)}  ` +
    `${String(median(settleFrames)).padStart(10)}  ${String(Math.max(0, ...settleFrames)).padStart(10)}  ` +
    `${(occMean * 100).toFixed(1).padStart(8)}` +
    (bad ? '   ← sprofonda' : '')
  );
```

Sopra il ciclo dei livelli dichiarare i due accumulatori globali:

```js
const allOccluded = [];
const allSettle = [];
```

- [ ] **Step 3: Stampare il riepilogo e far fallire l'occlusione troppo bassa**

Sostituire il blocco finale (da `console.log('─'.repeat(60));` fino alla fine) con:

```js
console.log('─'.repeat(74));

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const occPct = mean(allOccluded) * 100;
const settleMed = allSettle.length ? [...allSettle].sort((a, b) => a - b)[allSettle.length >> 1] : 0;

console.log(`assestamento mediano: ${settleMed} frame  (${(settleMed / 60).toFixed(2)} s)`);
console.log(`occlusione media:     ${occPct.toFixed(1)}%`);

if (failures) {
  console.error(`\n${failures} livelli con pezzi sotto il piano della scatola (BOX.floorY = ${BOX.floorY}).`);
  process.exit(1);
}

// Sotto questa soglia la pila è troppo piatta: senza sovrapposizione non c'è
// puzzle, solo una fila di oggetti da toccare in ordine (DESIGN.md §5).
if (occPct < 25) {
  console.error(`\nOcclusione media ${occPct.toFixed(1)}%: sotto il 25%, la pila è troppo piatta.`);
  process.exit(1);
}

console.log(`\nNessun pezzo sotto il piano; occlusione sopra la soglia del 25%.`);
```

- [ ] **Step 4: Registrare il baseline**

Run: `npm run verify:physics 1 12`
Expected: PASS. **Copiare l'intero tabulato**: è il baseline contro cui si giudica la Task 2. In particolare annotare `assestamento mediano` e `occlusione media`.

Se l'occlusione risultasse già sotto il 25% **con le costanti attuali**, fermarsi e segnalarlo: significherebbe che la soglia della spec è tarata male, non che il gioco è rotto. Non abbassare la soglia per far passare il test.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-physics.mjs
git commit -m "test: misura assestamento e occlusione, con soglia sul puzzle

Le due grandezze che la fisica più leggera può peggiorare: i frame di
assestamento (il ritmo fra una presa e l'altra) e la frazione di pezzi
coperti (il puzzle stesso). Sotto il 25% di occlusione la suite fallisce."
```

---

### Task 2: Applicare e tarare le costanti

**Files:**
- Modify: `src/level/physics.js`

**Interfaces:**
- Consumes: le metriche della Task 1.
- Produces: costanti nuove; nessuna firma cambia.

- [ ] **Step 1: Abbassare la gravità e ammorbidire lo smorzamento**

In `src/level/physics.js`, nel costruttore, sostituire la riga della gravità:

```js
    // -16 invece di -32: circa 1,6× la gravità terrestre. Resta rapido — il
    // livello deve partire in fretta — ma i pezzi non precipitano più come
    // piombo. Sotto questa soglia l'assestamento si allunga troppo e il gioco
    // aspetta fra una presa e l'altra (il grafo si ricostruisce a pila ferma).
    this.world = new RAPIER.World({ x: 0, y: -16, z: 0 });
```

In `create()`, sostituire i due damping:

```js
        .setLinearDamping(0.05)
        .setAngularDamping(0.25)
```

- [ ] **Step 2: Dare rimbalzo e togliere attrito**

In `create()`, sostituire la creazione del collider:

```js
    this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(h, h, h, border).setFriction(0.65).setRestitution(0.2),
      body
    );
```

In `setShapes()`, sostituire la riga corrispondente:

```js
      this.world.createCollider(desc.setFriction(0.65).setRestitution(0.2), body);
```

- [ ] **Step 3: Misurare, e qui si decide**

Run: `npm run verify:physics 1 12`

Confrontare con il baseline della Task 1:

- **Occlusione ≥ 25%** → si prosegue.
- **Occlusione < 25%** → lo script fallisce da solo. Alzare `friction` a passi di 0,05 (0,65 → 0,70 → 0,75) e rimisurare a ogni passo. L'attrito è la leva che governa quanto la pila resta compatta. Se a 0,85 (il valore di partenza) l'occlusione non risale, la leva successiva è la gravità: da −16 verso −20.
- **Assestamento mediano più che raddoppiato** rispetto al baseline → il ritmo ne soffre. Alzare la gravità verso −20 e rimisurare.

Registrare i numeri di ogni tentativo: servono al commit e all'utente.

- [ ] **Step 4: Verificare che la caduta iniziale finisca ancora**

`settleAndRecord()` esce o perché la pila si addormenta o perché finisce i passi (`DROP_STEPS = 420`). Con gravità dimezzata la caduta dura di più, e uscire per esaurimento significa che il livello parte da una pila ancora in movimento.

Aggiungere temporaneamente in `settleAndRecord()`, subito prima di `this.forceSleep();`:

```js
    if (!this.asleep()) console.warn(`[drop] esaurito DROP_STEPS con ${this.count} pezzi`);
```

Run: `npm run verify:levels 20 25`
Expected: **nessun** `[drop] esaurito`.

Se compare, alzare `DROP_STEPS` di 120 alla volta e ripetere finché sparisce. Poi **rimuovere la riga di `console.warn`**.

- [ ] **Step 5: Suite completa**

Run: `npm run verify`
Expected: tutte e quattro verdi, exit 0.

Se `verify:play` fallisce a qualche livello, la fisica ha cambiato la pila abbastanza da rompere una garanzia: fermarsi e riportarlo, non aggirarlo alzando i tentativi del solver.

- [ ] **Step 6: Commit**

```bash
git add src/level/physics.js
git commit -m "feat: caduta più leggera e vivace

Gravità da -32 a -16, rimbalzo da 0,02 a 0,2, smorzamento e attrito ridotti.
La massa non c'entra: in un corpo rigido non cambia la velocità di caduta.

Tarato contro le due metriche di verify-physics, non a occhio: l'occlusione
media resta sopra il 25% (sotto, la pila si appiattisce e il puzzle sparisce)
e l'assestamento non peggiora il ritmo fra una presa e l'altra."
```

---

### Task 3: `check-model`

**Files:**
- Create: `scripts/check-model.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: niente del gioco.
- Produces: `npm run check-model <file.glb>` → referto e exit code (0 = passa). La Task 4 lo richiama come ultimo passo.

- [ ] **Step 1: Installare la dipendenza**

Run: `npm install -D @gltf-transform/core`
Expected: si completa senza errori.

- [ ] **Step 2: Scrivere lo script**

Creare `scripts/check-model.mjs`:

```js
/**
 * Referto su un modello candidato.
 *
 *   node scripts/check-model.mjs <file.glb>
 *
 * I limiti vengono dal codice che carica i modelli (src/scene/shapes.js) e dai
 * vincoli di scena, non da regole generiche:
 *  · le proporzioni contano perché normalize() scala sulla SFERA contenitiva:
 *    un oggetto lungo e piatto diventa minuscolo negli assi corti
 *  · i triangoli contano perché in scatola ce ne stanno fino a 60 insieme
 *  · la scala NON conta: normalize() la rifà comunque
 */
import { NodeIO } from '@gltf-transform/core';
import { statSync } from 'node:fs';

const MAX_TRIANGLES = 8000;
const IDEAL_TRIANGLES = 4000;
const MAX_ASPECT = 2;
const MAX_TEXTURE = 256;

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
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
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
const sides = [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((s) => Math.abs(s));
const aspect = Math.max(...sides) / Math.max(1e-9, Math.min(...sides));

const textures = root.listTextures().map((t) => {
  const size = t.getSize();
  return { name: t.getName() || '(senza nome)', w: size?.[0] ?? 0, h: size?.[1] ?? 0 };
});
const biggest = textures.reduce((m, t) => Math.max(m, t.w, t.h), 0);
const hasUV = root.listMeshes().some((m) =>
  m.listPrimitives().some((p) => p.getAttribute('TEXCOORD_0'))
);
const bytes = statSync(file).size;

const rows = [
  ['triangoli', triangles.toLocaleString('it'), triangles <= MAX_TRIANGLES,
   triangles <= IDEAL_TRIANGLES ? 'ideale' : `limite ${MAX_TRIANGLES.toLocaleString('it')}`],
  ['proporzioni', aspect.toFixed(2), aspect <= MAX_ASPECT, `lungo/corto ≤ ${MAX_ASPECT}`],
  ['texture max', biggest ? `${biggest}px` : 'nessuna', biggest <= MAX_TEXTURE, `≤ ${MAX_TEXTURE}px`],
  ['UV', hasUV ? 'sì' : 'no', hasUV || textures.length === 0, 'servono se ci sono texture'],
  ['materiali', String(root.listMaterials().length), true, 'più di uno va bene: flatten() li fonde'],
  ['peso', `${(bytes / 1024).toFixed(0)} KB`, true, 'indicativo'],
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
```

- [ ] **Step 3: Aggiungere lo script a package.json**

In `package.json`, dentro `"scripts"`, aggiungere:

```json
    "check-model": "node scripts/check-model.mjs",
```

- [ ] **Step 4: Provarlo su un modello che deve passare**

Run: `npm run check-model public/models/Avocado.glb`
Expected: exit 0, tutte le righe con `✓`. Se una fallisce, è lo script a sbagliare: quel modello è in gioco da sempre.

- [ ] **Step 5: Provarlo su un modello al limite**

Run: `npm run check-model public/models/AntiqueCamera.glb`
Expected: referto stampato senza eccezioni. È il modello più pesante del set (1,35 MB): se esce `✗` su triangoli o proporzioni, **non correggere lo script per farlo passare** — annotare il valore e riportarlo, perché significa che un modello in produzione è fuori dai limiti dichiarati nella spec.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-model.mjs package.json package-lock.json
git commit -m "feat: check-model, referto sui modelli candidati

I limiti vengono dal codice che carica i modelli, non da regole generiche:
le proporzioni contano perché normalize() scala sulla sfera contenitiva, la
scala assoluta invece no. Licenza e silhouette restano giudizio umano."
```

---

### Task 4: `prepare-model`

**Files:**
- Create: `scripts/prepare-model.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/check-model.mjs` (richiamato come ultimo passo).
- Produces: `npm run prepare-model <file>` → `<nome>.glb` in `public/models/`.

- [ ] **Step 1: Installare gli strumenti**

Run: `npm install -D @gltf-transform/cli obj2gltf`
Expected: si completa senza errori.

- [ ] **Step 2: Accertare l'interfaccia reale della CLI**

Le opzioni di `gltf-transform` cambiano fra versioni maggiori, e il piano non deve indovinarle.

Run:
```bash
npx gltf-transform --version
npx gltf-transform simplify --help
npx gltf-transform resize --help
```

Annotare i nomi esatti delle opzioni per il rapporto di decimazione e per le dimensioni delle texture. Se un sottocomando non esiste con quel nome, cercarlo con `npx gltf-transform --help` e usare quello equivalente: lo scopo è decimare la geometria e ridurre le texture, non usare un comando specifico.

- [ ] **Step 3: Scrivere lo script**

Creare `scripts/prepare-model.mjs`, sostituendo le opzioni dei due comandi con quelle accertate allo Step 2 se differiscono:

```js
/**
 * Porta in specifica un modello scaricato dal web.
 *
 *   node scripts/prepare-model.mjs <file.obj|file.glb> [nome]
 *
 * I modelli in rete arrivano quasi sempre fuori specifica di uno o due ordini
 * di grandezza: centinaia di migliaia di triangoli e texture 2048² o 4096².
 * Questa pipeline converte, decima e riduce, poi passa la parola a check-model.
 *
 * Blender non serve: tutto da riga di comando. Chi ce l'ha può esportare .glb
 * per conto suo e saltare direttamente a check-model.
 *
 * Un .obj ha bisogno del suo .mtl e delle texture NELLA STESSA CARTELLA:
 * i riferimenti dentro il file sono relativi.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, extname } from 'node:path';

const MAX_TRIANGLES = 8000;
const MAX_TEXTURE = 256;

const input = process.argv[2];
if (!input) {
  console.error('uso: node scripts/prepare-model.mjs <file.obj|file.glb> [nome]');
  process.exit(2);
}
const name = process.argv[3] || basename(input, extname(input));
const work = mkdtempSync(join(tmpdir(), 'prep-'));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const kb = (f) => `${(statSync(f).size / 1024).toFixed(0)} KB`;

console.log(`\nsorgente: ${input}  (${kb(input)})`);

// 1 · in glTF
let current = join(work, 'in.glb');
if (extname(input).toLowerCase() === '.obj') {
  console.log('\n· conversione da OBJ');
  run('npx', ['--yes', 'obj2gltf', '-i', input, '-o', current, '--binary']);
} else {
  copyFileSync(input, current);
}

// 2 · decimazione: la geometria è quasi sempre il problema principale
console.log('\n· decimazione');
const simplified = join(work, 'simple.glb');
run('npx', ['--yes', 'gltf-transform', 'simplify', current, simplified,
            '--ratio', '0.02', '--error', '0.005']);
current = simplified;

// 3 · texture a 256²: a questa distanza è già più del necessario
console.log('\n· riduzione delle texture');
const resized = join(work, 'small.glb');
run('npx', ['--yes', 'gltf-transform', 'resize', current, resized,
            '--width', String(MAX_TEXTURE), '--height', String(MAX_TEXTURE)]);
current = resized;

// 4 · pulizia di ciò che il gioco non usa
console.log('\n· pulizia');
const pruned = join(work, 'pruned.glb');
run('npx', ['--yes', 'gltf-transform', 'prune', current, pruned]);
current = pruned;

const out = join('public', 'models', `${name}.glb`);
copyFileSync(current, out);
console.log(`\nrisultato: ${out}  (${kb(out)})`);

// 5 · il verdetto lo dà check-model, così i limiti stanno in un posto solo
console.log('\n· verifica');
run('node', ['scripts/check-model.mjs', out]);
```

- [ ] **Step 4: Aggiungere lo script a package.json**

In `package.json`, dentro `"scripts"`, aggiungere:

```json
    "prepare-model": "node scripts/prepare-model.mjs",
```

- [ ] **Step 5: Provarlo su un file vero**

Un convertitore che gira senza errori ma produce una geometria irriconoscibile ha fallito lo stesso. Serve un modello reale, non un test sintetico.

Run: `npm run prepare-model public/models/AntiqueCamera.glb prova-camera`

Expected: la pipeline arriva in fondo e `check-model` dà `✓` su triangoli e texture. Poi **guardare il risultato**, non solo i numeri:

```bash
npm run dev
```

Sostituire temporaneamente una voce di `MODELS` in `src/scene/shapes.js` con `{ file: 'prova-camera', name: 'prova' }`, aprire il gioco e verificare che l'oggetto sia ancora riconoscibile. Poi **ripristinare `shapes.js` e cancellare `public/models/prova-camera.glb`**.

Se `--ratio 0.02` distrugge la forma, alzarlo (0,05 → 0,1) finché il modello resta riconoscibile pur restando sotto gli 8.000 triangoli, e aggiornare il valore nello script.

- [ ] **Step 6: Commit**

```bash
git add scripts/prepare-model.mjs package.json package-lock.json
git commit -m "feat: prepare-model, dal file scaricato al .glb in specifica

Converte da OBJ, decima la geometria e riduce le texture a 256², poi lascia
il verdetto a check-model così i limiti restano in un posto solo.
Blender non è richiesto."
```

---

### Task 5: Documentazione

**Files:**
- Modify: `DESIGN.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: i valori finali della Task 2 e i due comandi delle Task 3-4.

- [ ] **Step 1: Aggiornare `DESIGN.md` §5 con la scelta della fisica**

Aggiungere alla lista delle decisioni non ovvie, subito prima di «**Fisica viva per tutto il livello**»:

```markdown
- **La caduta è tarata su due metriche, non a occhio.** «Meno pesante» non si
  ottiene abbassando la massa: in un corpo rigido non cambia la velocità di
  caduta. Le leve vere sono gravità, rimbalzo, smorzamento e attrito. Ma
  ammorbidirle degrada due grandezze nella direzione opposta a quella voluta:
  l'assestamento si allunga (e il grafo di occlusione si ricostruisce solo a
  pila ferma, quindi diventa attesa fra una presa e l'altra) e soprattutto la
  pila si **appiattisce** — con meno attrito i pezzi si sparpagliano invece di
  accatastarsi, e senza sovrapposizione non c'è puzzle. `verify:physics` misura
  entrambe e fallisce sotto il 25% di occlusione media.
```

- [ ] **Step 2: Correggere il residuo dei «12 modelli»**

In `DESIGN.md`, nella riga della tabella §3 dei tipi distinti, sostituire il tetto `12` con `6` e aggiungere sotto la tabella:

```markdown
> ⚠️ Il tetto di `K` è oggi **6**, quanti sono i modelli in `public/models/`.
> La tabella indicava 12, numero ereditato dal Food Kit di Kenney che il gioco
> usava prima (vedi CREDITS.md): con 6 tipi la leva della varietà è ferma dal
> livello 6 in poi, cioè una delle tre leve di difficoltà non lavora per la
> maggior parte della curva. Si sblocca aggiungendo modelli — `npm run
> prepare-model` porta in specifica un file scaricato dal web.
```

Nella riga §5 che dice «I 12 modelli sono scelti fra i campioni glTF di Khronos», sostituire `12` con `6`.

In §7, sostituire «shapes (12 tipi procedurali)» con «shapes (i tipi, da modelli glTF)».

- [ ] **Step 3: Aggiungere i comandi al README**

In `README.md`, dopo il blocco delle verifiche, aggiungere:

```markdown
## Aggiungere un oggetto

I modelli vanno in `public/models/` come `.glb` singoli, con le texture dentro.
Un file scaricato dal web quasi mai rispetta i limiti (triangoli, texture):

```bash
npm run prepare-model ~/Downloads/Strawberry.obj fragola   # converte e riduce
npm run check-model public/models/fragola.glb              # solo il referto
```

Poi va aggiunto a `MODELS` in `src/scene/shapes.js`. Licenza e leggibilità
della silhouette restano giudizio umano: gli strumenti misurano il resto.
```

- [ ] **Step 4: Verificare che i comandi documentati esistano**

Run: `npm run check-model public/models/Avocado.glb`
Expected: exit 0. Conferma che il comando citato nel README funziona come scritto.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md README.md
git commit -m "docs: fisica tarata su metriche, e i 12 modelli che erano 6

DESIGN.md prometteva 12 tipi distinti, numero ereditato dal Food Kit di
Kenney: i modelli sono 6, quindi la leva della varietà è ferma dal livello 6."
```

---

### Task 6: Rilascio

- [ ] **Step 1: Suite completa**

Run: `npm run verify`
Expected: quattro suite verdi, exit 0.

- [ ] **Step 2: Prova a mano — il giudizio che le metriche non danno**

```bash
npm run dev
```

Le metriche dicono se il gioco è ancora giocabile, non se la caduta è piacevole. Guardare: i pezzi rotolano invece di incollarsi? la pila resta accatastata o si è sparpagliata? togliendo un pezzo la frana è leggibile?

**Questo passo richiede l'utente**: è la sua richiesta di partenza, e il verdetto è suo.

- [ ] **Step 3: Push e pull request**

```bash
git push origin develop
gh pr create --base master --head develop --title "Caduta più leggera e strumenti per i modelli"
```

Nel corpo della PR riportare la tabella **prima/dopo** delle due metriche: è la prova che il puzzle non è stato sacrificato all'estetica.

- [ ] **Step 4: Merge dopo il via libera dell'utente**

Il merge su `master` fa partire il deploy su `3dgame.pallade.it`. Non farlo senza conferma esplicita.
