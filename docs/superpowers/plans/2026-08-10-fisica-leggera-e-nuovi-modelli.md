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
- Non toccare `src/core/levels.js` e non rifare i sei `.glb` già in `public/models/`.
- `TYPE_COUNT` diventa **dinamico** (Task 5): è il numero di file in `public/models/`. Nessun tetto alla difficoltà per ora — decisione presa dall'utente, ma l'impatto va **misurato** con `verify:play` quando i modelli nuovi esisteranno, e i numeri riportati prima di lasciarlo così.
- Il random della tavolozza (Task 6) deve essere **seminato dall'rng del livello**: `README.md` e `DESIGN.md` §7 garantiscono che `(seed, livello)` dia un livello identico, e le quattro suite hanno senso solo grazie a questo.
- Lingua di commenti, documentazione e commit: **italiano**.
- Branch di lavoro `develop`; la produzione è `master` via pull request.

## File Structure

| File | Stato | Responsabilità |
|---|---|---|
| `scripts/verify-physics.mjs` | modificare | aggiunge due metriche (assestamento, occlusione) al controllo che ha già |
| `src/level/physics.js` | modificare | gravità, `restitution`, damping, `friction`, `DROP_STEPS` |
| `scripts/check-model.mjs` | creare | referto su un `.glb`, verdetto passa/non passa |
| `scripts/prepare-model.mjs` | creare | conversione + decimazione + riduzione texture, poi referto |
| `scripts/sync-models.mjs` | creare | genera il manifest scandendo `public/models/` |
| `src/scene/models.generated.js` | creare (generato, versionato) | l'elenco dei modelli, leggibile sia da Vite sia da Node |
| `src/scene/shapes.js` | modificare | importa il manifest invece dell'elenco scritto a mano |
| `src/level/generate.js` | modificare | estrae la tavolozza del livello dal suo rng |
| `src/game/game.js` | modificare | mesh e scafi presi dalla tavolozza, non dall'elenco completo |
| `package.json` | modificare | script `check-model`, `prepare-model`, `models` + hook `pre*`; dipendenze di sviluppo |
| `DESIGN.md` | modificare | §3 e §5: costanti nuove, tavolozza per livello, e il residuo dei «12 modelli» |
| `README.md` | modificare | i comandi nuovi e come si aggiunge un oggetto |

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

### Task 1b: I primi livelli senza occlusione

Emersa misurando il baseline della Task 1, e da fare **prima** della Task 2: cambia l'occlusione, quindi cambia il metro con cui si giudica la fisica nuova.

Livelli 1-2 a **0,0%** di occlusione, 3-4 sotto il 4%. Nei primi quattro livelli la pila è un unico strato piatto: nessun pezzo ne copre un altro, quindi nessun puzzle spaziale. `DESIGN.md` §5 dice che il dimensionamento della scatola serve proprio a evitarlo.

**Causa**, letta in `src/scene/setup.js:35`:

```js
const side = Math.sqrt((itemCount * ITEM_FOOTPRINT) / layers);
return Math.min(6, Math.max(3, side + MARGIN));
```

Per 3 strati i primi livelli vorrebbero un lato fra 2,08 (21 pezzi) e 2,73 (36 pezzi), ma il `Math.max(3, …)` li porta tutti a 3. Una scatola di lato 3 tiene ~14,5 pezzi per strato: il livello 1 ne riempie 1,45.

**Il minimo però non è arbitrario.** In `PileWorld.spawn()` il passo fra le colonne è `usable / cols` con `usable = BOX.size - 2·ITEM_RADIUS`. A lato 3 il passo vale 1,06, appena sopra `CELL` (1,0). A lato 2,6 scende a 0,86: i pezzi nascerebbero **compenetrati**, e `physics.js:110` avverte che le compenetrazioni sparano i pezzi fuori dalla scatola. Abbassare il minimo senza toccare lo spawn romperebbe la generazione.

**Files:**
- Modify: `src/scene/setup.js:18-37` (`spawnColumns`, `computeBoxSize`)
- Modify: `src/level/physics.js` (`spawn()`, se il passo va ricavato diversamente)

**Interfaces:**
- Consumes: `CELL`, `ITEM_FOOTPRINT`, `MARGIN`, `ITEM_RADIUS`.
- Produces: `computeBoxSize(itemCount, layers)` con minimo più basso; `spawnColumns(size)` che non promette mai più colonne di quante ne entrino a passo `CELL`.

- [ ] **Step 1: Rendere onesto il numero di colonne**

In `src/scene/setup.js` sostituire `spawnColumns`:

```js
/**
 * Colonne di spawn che entrano in una scatola di lato `size`.
 *
 * Il passo fra le colonne non deve mai scendere sotto CELL: sotto, i pezzi
 * nascono compenetrati e la prima simulazione li spara fuori dalla scatola
 * (vedi il commento di resetToSpawn in physics.js). Con scatole molto strette
 * la risposta giusta è UNA colonna e più strati, non due colonne sovrapposte.
 */
export function spawnColumns(size) {
  const usable = Math.max(CELL, size - ITEM_RADIUS * 2);
  return Math.max(1, Math.floor(usable / CELL));
}
```

- [ ] **Step 2: Abbassare il minimo della scatola**

In `src/scene/setup.js` sostituire il `return` di `computeBoxSize`:

```js
  // Il minimo è il lato che ospita una sola colonna a passo pieno. Più in
  // basso non si può: sotto, i pezzi nascerebbero uno dentro l'altro.
  // Era 3, che sui primi livelli imponeva una pila di un solo strato — cioè
  // nessuna occlusione, cioè nessun puzzle (misurato: 0,0% ai livelli 1-2).
  const min = CELL + ITEM_RADIUS * 2;
  return Math.min(6, Math.max(min, side + MARGIN));
```

- [ ] **Step 3: Misurare l'effetto sull'occlusione**

Run: `npm run verify:physics 1 12`

Expected: l'occlusione iniziale dei livelli 1-4 **sale sopra lo zero**; la media complessiva sale sopra il baseline di 16,5%.

Se i livelli 1-2 restano a 0,0%, il minimo è ancora troppo alto: stampare `computeBoxSize(21, 3)` e confrontarlo col 2,08 teorico.

- [ ] **Step 4: Verificare che la generazione non si sia rotta**

Run: `npm run verify`
Expected: quattro suite verdi, exit 0.

⚠️ Il segnale di compenetrazione allo spawn è un livello che fallisce in `verify:levels` o pezzi con `minY` anomalo in `verify:physics`. Se compare, il passo delle colonne è ancora sotto `CELL`: **non** aggirarlo alzando i tentativi del solver.

- [ ] **Step 5: Prova a occhio**

```bash
npm run dev
```

Aprire `?level=1` e `?level=2`: la pila deve avere più di uno strato e qualche pezzo coperto. Non deve invece sembrare una torre in colonna al centro — se lo è, `spawnColumns` sta restituendo 1 dove ne entrerebbero 2.

- [ ] **Step 6: Registrare il nuovo baseline**

Rilanciare `npm run verify:physics 1 12` e **annotare** assestamento mediano e occlusione media: sostituiscono i numeri della Task 1 come metro per la Task 2.

Aggiornare di conseguenza il commento di intestazione di `scripts/verify-physics.mjs`, che cita il baseline del 2026-08-10.

- [ ] **Step 7: Commit**

```bash
git add src/scene/setup.js scripts/verify-physics.mjs
git commit -m "fix: i primi livelli avevano un solo strato, quindi nessun puzzle

Livelli 1-2 con occlusione 0,0%: la scatola non poteva scendere sotto il
lato 3, mentre per tenere i ~3 strati promessi da DESIGN.md ne servirebbe
uno da 2,08 con 21 pezzi. Il minimo era lì per un motivo — sotto, il passo
fra le colonne di spawn scende sotto CELL e i pezzi nascono compenetrati —
quindi scende insieme a spawnColumns, che ora non promette mai più colonne
di quante ne entrino a passo pieno."
```

---

### Task 2: Applicare e tarare le costanti

**Files:**
- Modify: `src/level/physics.js`

**Interfaces:**
- Consumes: le metriche della Task 1, **aggiornate dalla Task 1b**.
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

### Task 5: Manifest automatico dei modelli

L'utente copia `.glb` in `public/models/` e devono comparire nel gioco senza toccare il codice.

`import.meta.glob` **non** è utilizzabile: è una trasformazione di Vite, ma `src/scene/shapes.js` è importato anche da `scripts/headless.mjs`, che gira in Node puro per le quattro suite. Serve un manifest generato, importabile da entrambi.

**Files:**
- Create: `scripts/sync-models.mjs`
- Create: `src/scene/models.generated.js` (prodotto dallo script, versionato)
- Modify: `src/scene/shapes.js:25-34`
- Modify: `package.json`

**Interfaces:**
- Produces: `src/scene/models.generated.js` esporta `export const MODELS = [{ file, name }, ...]`. `shapes.js` lo importa al posto della costante scritta a mano; `TYPE_COUNT` resta `MODELS.length`.

- [ ] **Step 1: Scrivere lo script di sincronizzazione**

Creare `scripts/sync-models.mjs`:

```js
/**
 * Genera src/scene/models.generated.js scandendo public/models/.
 *
 * Perché un file generato e non `import.meta.glob`: quest'ultimo è una
 * trasformazione di Vite, ma shapes.js viene importato anche da
 * scripts/headless.mjs, che gira in Node puro per le verifiche. Un modulo
 * generato lo leggono entrambi.
 *
 * Gira da solo prima di `dev`, `build` e delle verifiche: copiare un .glb
 * nella cartella basta.
 */
import { readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODELS_DIR = fileURLToPath(new URL('../public/models/', import.meta.url));
const OUT = fileURLToPath(new URL('../src/scene/models.generated.js', import.meta.url));

// Nomi italiani per i modelli storici: dal nome del file non si deducono.
const KNOWN = {
  Avocado: 'avocado',
  BoomBox: 'stereo',
  WaterBottle: 'borraccia',
  AntiqueCamera: 'macchina fotografica',
  Corset: 'corsetto',
  SunglassesKhronos: 'occhiali da sole',
};

const files = readdirSync(MODELS_DIR)
  .filter((f) => f.toLowerCase().endsWith('.glb'))
  .map((f) => f.slice(0, -4))
  .sort();

if (files.length === 0) {
  console.error('Nessun .glb in public/models/: il gioco non avrebbe tipi.');
  process.exit(1);
}

const entries = files.map((file) => {
  // Dal nome del file: "RedStrawberry" o "red_strawberry" → "red strawberry".
  const fallback = file
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return { file, name: KNOWN[file] ?? fallback };
});

const body = `// GENERATO da scripts/sync-models.mjs — non modificare a mano.
// Si rigenera da solo prima di dev, build e verifiche: per aggiungere un
// oggetto basta copiare il suo .glb in public/models/.
export const MODELS = [
${entries.map((e) => `  { file: '${e.file}', name: '${e.name}' },`).join('\n')}
];
`;

const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (before !== body) {
  writeFileSync(OUT, body);
  console.log(`models.generated.js: ${entries.length} modelli`);
}
```

- [ ] **Step 2: Far leggere il manifest a shapes.js**

In `src/scene/shapes.js`, sostituire il blocco `const MODELS = [...]` (righe 25-32) con:

```js
// L'elenco lo genera scripts/sync-models.mjs scandendo public/models/:
// per aggiungere un oggetto basta copiarci dentro il suo .glb.
import { MODELS } from './models.generated.js';
```

L'import va spostato in cima al file, insieme agli altri. La riga
`export const TYPE_COUNT = MODELS.length;` resta invariata.

Aggiornare anche il commento del blocco che parlava dell'ordine per contrasto
decrescente: quell'ordine non esiste più (vedi Task 6), la tavolozza è per livello.

- [ ] **Step 3: Agganciarlo ai comandi**

In `package.json`, dentro `"scripts"`, aggiungere:

```json
    "models": "node scripts/sync-models.mjs",
    "predev": "node scripts/sync-models.mjs",
    "prebuild": "node scripts/sync-models.mjs",
    "preverify": "node scripts/sync-models.mjs",
```

- [ ] **Step 4: Generare e verificare che nulla cambi**

Run: `npm run models`
Expected: scrive `src/scene/models.generated.js` con **6** modelli.

Run: `cat src/scene/models.generated.js`
Expected: i sei nomi italiani corretti (`avocado`, `stereo`, `borraccia`, `macchina fotografica`, `corsetto`, `occhiali da sole`), presi da `KNOWN`.

- [ ] **Step 5: Le suite devono restare verdi**

Run: `npm run verify`
Expected: exit 0. È il controllo che conta: dimostra che il manifest funziona **anche in Node puro**, che è l'intero motivo per cui esiste invece di `import.meta.glob`.

- [ ] **Step 6: Provare l'aggiunta di un file**

```bash
cp public/models/Avocado.glb public/models/ProvaAggiunta.glb
npm run models
grep -c "file:" src/scene/models.generated.js   # atteso: 7
rm public/models/ProvaAggiunta.glb
npm run models
grep -c "file:" src/scene/models.generated.js   # atteso: 6
```

Expected: 7 poi 6, e il nome derivato per `ProvaAggiunta` è `prova aggiunta`.

- [ ] **Step 7: Commit**

```bash
git add scripts/sync-models.mjs src/scene/models.generated.js src/scene/shapes.js package.json
git commit -m "feat: i modelli si caricano da soli da public/models/

Un manifest generato, non import.meta.glob: shapes.js è importato anche da
headless.mjs, che gira in Node puro per le verifiche, dove la trasformazione
di Vite non esiste. Si rigenera prima di dev, build e verify."
```

---

### Task 6: Tavolozza casuale per livello

Richiesta: i tipi mescolati, non sempre i primi N. Ma il random deve essere **seminato**: `README.md` e `DESIGN.md` §7 garantiscono che `(seed, livello)` dia un livello identico, e le quattro suite hanno senso solo grazie a questo.

Oggi un livello usa i tipi `0..K-1`, cioè sempre i primi K modelli. La tavolozza li rimpiazza con un sottoinsieme estratto dal rng del livello: il livello 7 mostra sempre gli stessi oggetti, diversi da quelli dell'8.

**Files:**
- Modify: `src/level/generate.js:46` e il valore di ritorno
- Modify: `src/game/game.js:32`, `:93`, `:626`

**Interfaces:**
- Consumes: `getItemTypes()`, `getHulls()` da `shapes.js`; `rng.next()`.
- Produces: `generateLevel()` restituisce in più `palette` — `Int32Array` di lunghezza `typeCount`, dove `palette[k]` è l'indice del modello usato dal tipo `k` del livello.

- [ ] **Step 1: Estrarre la tavolozza in generate.js**

In `src/level/generate.js`, sostituire la riga `const hulls = getHulls();` con:

```js
  // Tavolozza del livello: quali modelli rappresentano i tipi 0..typeCount-1.
  // Estratta dal rng del livello, quindi (seed, livello) resta riproducibile —
  // senza, le quattro suite girerebbero ogni volta su un livello diverso.
  const allHulls = getHulls();
  const palette = pickPalette(allHulls.length, typeCount, rng);
  const hulls = palette.map((m) => allHulls[m]);
```

In fondo al file aggiungere:

```js
/** Sottoinsieme di `count` modelli su `total`, senza ripetizioni (Fisher-Yates). */
function pickPalette(total, count, rng) {
  const pool = Int32Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return Array.from(pool.slice(0, count));
}
```

Aggiungere `palette` all'oggetto restituito da `generateLevel`, accanto a `types`.

- [ ] **Step 2: Far usare la tavolozza alle mesh**

In `src/game/game.js`, alla riga 32 sostituire `this.types = getItemTypes();` con:

```js
    this.allTypes = getItemTypes();
    this.types = this.allTypes;   // rimpiazzata a ogni livello dalla tavolozza
```

Dove oggi c'è `this.itemTypes = data.types;` (riga 93) aggiungere subito sotto:

```js
    this.palette = data.palette;
    this.types = this.palette.map((m) => this.allTypes[m]);
```

- [ ] **Step 3: Allineare il booster shuffle**

Alla riga 626 `this.physics.setShapes(this.itemTypes, getHulls());` sostituire con:

```js
        // Gli scafi vanno presi nella tavolozza del livello, non nell'elenco
        // completo: gli id dei tipi sono densi (0..K-1) e la tavolozza è la
        // sola cosa che li lega ai modelli veri.
        this.physics.setShapes(this.itemTypes, this.palette.map((m) => getHulls()[m]));
```

- [ ] **Step 4: Verificare che la riproducibilità tenga**

Run: `npm run verify:levels 1 25`
Expected: PASS. Se un livello risultasse irrisolvibile, la tavolozza non c'entra: i tipi restano densi `0..K-1` e il solver non guarda i modelli.

Run due volte: `npm run verify:play 3 3` e di nuovo `npm run verify:play 3 3`
Expected: **output identico**. È la prova che il random è seminato. Se cambia, `pickPalette` sta usando una fonte di casualità diversa dall'rng del livello.

- [ ] **Step 5: Verificare che livelli diversi peschino modelli diversi**

```bash
node -e "
import('./scripts/headless.mjs').then(async (h) => {
  await h.setupHeadless();
  const { levelConfig } = await import('./src/core/levels.js');
  const { generateLevel } = await import('./src/level/generate.js');
  const { createCamera } = await import('./src/scene/setup.js');
  const { Rng } = await import('./src/core/rng.js');
  for (const l of [3, 4, 5]) {
    const d = await generateLevel(levelConfig(l), createCamera(0.5), new Rng(l));
    console.log('livello', l, 'tavolozza', d.palette.join(','));
  }
});
"
```

Expected: tre tavolozze **diverse** fra loro. Se sono identiche, l'rng non sta variando col livello.

⚠️ Se `Rng` non si esporta con quel nome, leggere `src/core/rng.js` e usare quello vero: il punto del controllo è confrontare tre livelli, non la firma del costruttore.

- [ ] **Step 6: Suite completa**

Run: `npm run verify`
Expected: exit 0, tutte e quattro verdi.

- [ ] **Step 7: Commit**

```bash
git add src/level/generate.js src/game/game.js
git commit -m "feat: ogni livello pesca la sua tavolozza di modelli

I tipi non sono più sempre i primi N: ogni livello estrae il suo
sottoinsieme dal proprio rng. Seminato, non casuale a ogni avvio — README e
DESIGN garantiscono che (seed, livello) dia un livello identico, ed è la
base su cui le quattro suite hanno senso.

Si perde l'ordinamento per contrasto decrescente: un livello basso può
pescare silhouette simili. Scelta esplicita, reversibile nel manifest."
```

---

### Task 7: Documentazione

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

### Task 8: Rilascio

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
