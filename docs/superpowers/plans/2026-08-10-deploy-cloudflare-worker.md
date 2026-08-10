# Pubblicazione su Cloudflare Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** servire il prototipo 3DG da `https://3dgame.pallade.it` come Cloudflare Worker di soli asset statici, distribuito automaticamente a ogni push su `master`.

**Architecture:** nessun codice Worker. `wrangler.jsonc` alla root dichiara `dist/` (prodotta da Vite) come directory di asset; Cloudflare la serve dalla sua rete. `public/_headers` governa la cache, distinguendo gli asset con hash nel nome da quelli senza. Un workflow GitHub Actions gira build e verifiche headless sulle pull request, ma non è nel percorso del deploy.

**Tech Stack:** Vite 8, three 0.185, `@dimforge/rapier3d-compat`, Node 22, Wrangler / Cloudflare Workers Static Assets.

**Spec di riferimento:** [`docs/superpowers/specs/2026-08-10-deploy-cloudflare-worker-design.md`](../specs/2026-08-10-deploy-cloudflare-worker-design.md)

## Global Constraints

- Dominio pubblico: **`3dgame.pallade.it`** — terzo livello della zona `pallade.it`, già su Cloudflare.
- Branch di produzione: **`master`**. Branch di lavoro: **`develop`** (branch corrente).
- Node: **22**.
- Nome del Worker: **`3dgame`**. Se Cloudflare lo rifiuta perché inizia con una cifra, ripiegare su `game3d` e allineare `wrangler.jsonc` e il dashboard.
- `compatibility_date`: **`2026-08-10`**.
- `not_found_handling`: **`"none"`** — mai `"single-page-application"`. Il progetto non ha router client-side.
- **Vietato** creare un file `_redirects` con `/* /index.html 200`: Cloudflare rifiuta il deploy con `Infinite loop detected in this rule [code: 100324]`, e lo fa dopo aver caricato gli asset.
- **Non toccare `src/`**, con l'unica eccezione prevista dalla Task 1 (`vite.config.js`, solo se la build lo impone).
- La lingua di commenti, documentazione e messaggi di commit è l'italiano, come nel resto del repo.

## File Structure

| File | Stato | Responsabilità |
|---|---|---|
| `.nvmrc` | creare | fissa Node 22 per build locale e CI |
| `vite.config.js` | creare **solo se serve** (Task 1) | alza `build.target` per il top-level await di `src/main.js:22` |
| `wrangler.jsonc` | creare | dichiara il Worker ad asset statici: nome, `dist/`, gestione dei 404, observability |
| `public/_headers` | creare | politica di cache per path; copiato in `dist/` da Vite |
| `.github/workflows/ci.yml` | creare | build + verifiche headless su push a `develop` e PR verso `master`/`develop` |
| `DEPLOY.md` | creare | configurazione del dashboard, checklist di rilascio, verifiche post-deploy |
| `README.md` | modificare | sezione *Pubblicazione* che rimanda a `DEPLOY.md` |

---

### Task 1: Build riproducibile

Prima di configurare qualunque cosa su Cloudflare bisogna sapere che `npm run build` produce davvero una `dist/` servibile. Il rischio concreto è il top-level await in `src/main.js:22`.

**Files:**
- Create: `.nvmrc`
- Create (condizionale, solo se lo Step 3 fallisce): `vite.config.js`

**Interfaces:**
- Consumes: niente.
- Produces: la directory `dist/` con `index.html`, `assets/*` (nomi con hash) e `models/*.glb` (nomi invariati). Le Task 2 e 5 dipendono da questa struttura.

- [ ] **Step 1: Creare `.nvmrc`**

```
22
```

- [ ] **Step 2: Installare le dipendenze**

Run: `npm install --no-audit --no-fund`
Expected: si completa senza errori; compare `node_modules/`.

- [ ] **Step 3: Costruire, ed è qui che si scopre se serve una config**

Run: `npm run build`

Due esiti possibili, entrambi previsti:

- **Passa** → non creare `vite.config.js`. Saltare allo Step 5. Una config che non serve è una config che poi nessuno sa perché c'è.
- **Fallisce** con un messaggio su *top-level await* / *target* (per esempio `Top-level await is not available in the configured target environment`) → procedere con lo Step 4.

- [ ] **Step 4: Solo se lo Step 3 è fallito — creare `vite.config.js`**

```js
import { defineConfig } from 'vite';

// `src/main.js` attende il caricamento dei modelli a livello di modulo
// (`await loadItemTypes()`): senza i modelli non esistono né le mesh né i
// collider, quindi non ha senso costruire il gioco prima. Il top-level await
// richiede un target moderno; col target di default la build si rifiuta di
// produrre il bundle.
export default defineConfig({
  build: { target: 'esnext' },
});
```

Poi rilanciare `npm run build`.
Expected: PASS.

- [ ] **Step 5: Ispezionare il risultato**

Run: `ls dist && ls dist/assets && ls dist/models`

Expected — e questi tre fatti sono il presupposto della Task 2:
- `dist/index.html` esiste
- i file in `dist/assets/` hanno un **hash nel nome** (es. `index-a1b2c3d4.js`)
- i file in `dist/models/` si chiamano **come in `public/models/`**, senza hash: `Avocado.glb`, `BoomBox.glb`, `WaterBottle.glb`, `AntiqueCamera.glb`, `Corset.glb`, `SunglassesKhronos.glb`

- [ ] **Step 6: Verificare che il gioco costruito funzioni davvero**

Run: `npm run preview`
Aprire `http://localhost:4173`.
Expected: il livello 1 carica, gli oggetti 3D sono texturizzati (non bianchi: significherebbe modelli non trovati), un tap prende un pezzo, il trascinamento gira la scatola. Poi `http://localhost:4173/?level=12` deve partire dal livello 12.

Fermare il server con Ctrl-C.

- [ ] **Step 7: Verifiche headless**

Run: `npm run verify`
Expected: PASS su tutte e tre (livelli, playthrough, booster). Può richiedere qualche minuto.

- [ ] **Step 8: Commit**

```bash
git add .nvmrc
git add vite.config.js 2>/dev/null || true   # solo se lo Step 4 l'ha creato
git commit -m "build: fissa Node 22 per build e CI"
```

Se lo Step 4 ha creato `vite.config.js`, usare invece questo messaggio:

```bash
git commit -m "build: fissa Node 22 e alza il target per il top-level await"
```

---

### Task 2: Configurazione del Worker e politica di cache

**Files:**
- Create: `wrangler.jsonc`
- Create: `public/_headers`

**Interfaces:**
- Consumes: la struttura di `dist/` prodotta dalla Task 1.
- Produces: un Worker distribuibile con `npx wrangler deploy`. La Task 4 documenta questi file; la Task 5 li manda in produzione.

- [ ] **Step 1: Creare `wrangler.jsonc`**

```jsonc
{
  // =====================================================
  // Cloudflare — pubblicazione del gioco come Worker con asset statici.
  //
  // Non c'è codice Worker: nessun campo "main". Tutta la logica sta nel
  // browser — un livello è funzione di (seed, numero livello) e non esiste
  // nessun servizio da interrogare.
  //
  // Deploy: lo fa Cloudflare a ogni push su `master`, eseguendo
  //   build:  npm run build
  //   deploy: npx wrangler deploy
  // Da locale si può fare lo stesso con `npx wrangler deploy` dopo `npm run build`.
  // =====================================================
  // Deve combaciare col nome del progetto su Cloudflare: `wrangler deploy` usa
  // questo campo per decidere SU QUALE Worker distribuire, e un nome diverso
  // finirebbe su un Worker separato da quello collegato al repo.
  // Determina anche il sottodominio *.workers.dev — non il dominio pubblico,
  // che è un Custom Domain configurato dal dashboard (vedi DEPLOY.md).
  "name": "3dgame",
  "compatibility_date": "2026-08-10",

  "assets": {
    // Prodotta da `npm run build`.
    "directory": "./dist",

    // A differenza di ../gym, qui NON va "single-page-application".
    // gym ha un router Vue: /allenamento non è un file e senza fallback
    // darebbe 404. Questo gioco non ha rotte — il livello si sceglie con
    // ?level=N, che non tocca il path. Col fallback attivo, un .glb mancante
    // riceverebbe index.html al posto di un 404, e l'errore arriverebbe al
    // giocatore come un parse error incomprensibile invece che come
    // "file non trovato".
    "not_found_handling": "none"
  },

  // Log delle richieste nel dashboard: utile per capire se un 404 arriva
  // davvero a Cloudflare o si ferma prima (DNS, certificato).
  "observability": {
    "enabled": true
  }
}
```

- [ ] **Step 2: Creare `public/_headers`**

Sta in `public/` perché Vite copia quella cartella tal quale dentro `dist/`, ed è lì che Cloudflare lo cerca.

```
# Cloudflare Workers — header per path.
#
# La distinzione che conta è fra ciò che passa dalla pipeline di Vite e ciò
# che no. Vite mette l'hash nel nome solo al primo gruppo.

# index.html è il punto d'ingresso: se resta in cache, dopo un deploy il
# browser continua a chiedere i bundle vecchi.
/index.html
  Cache-Control: no-cache

# Nomi con hash: il contenuto non può cambiare a parità di nome, quindi la
# cache può essere eterna.
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# I .glb stanno in public/ e Vite li copia SENZA hash: il nome resta lo
# stesso anche se il modello cambia. Una cache immutabile qui significherebbe
# che un modello corretto non raggiunge più chi ha già visitato il sito.
# Un giorno è il compromesso: 3,5 MB non riscaricati a ogni partita, e una
# modifica si propaga da sola entro 24 ore.
/models/*
  Cache-Control: public, max-age=86400
```

- [ ] **Step 3: Ricostruire, così `_headers` finisce in `dist/`**

Run: `npm run build && ls dist/_headers`
Expected: il file esiste in `dist/`.

- [ ] **Step 4: Servire `dist/` come lo servirà Cloudflare**

Run: `npx wrangler dev`
Expected: parte su `http://localhost:8787` (annotare la porta se diversa).

- [ ] **Step 5: Verificare gli header e la gestione dei 404**

In un altro terminale:

```bash
curl -sI http://localhost:8787/ | grep -i 'cache-control'
curl -sI http://localhost:8787/models/Avocado.glb | grep -i 'cache-control\|content-type'
curl -so /dev/null -w '%{http_code}\n' http://localhost:8787/questo-path-non-esiste
```

Expected:
- `/` → `no-cache`
- `/models/Avocado.glb` → `public, max-age=86400`
- path inesistente → **`404`**. Se risponde `200`, `not_found_handling` non è `"none"`: correggerlo prima di proseguire.

⚠️ Se `wrangler dev` **non** applica `_headers` in locale (il supporto è recente e dipende dalla versione), non modificare i file per inseguirlo: annotarlo e rimandare la verifica degli header alla Task 5, in produzione. Il controllo sul 404, invece, deve passare qui.

Fermare `wrangler dev` con Ctrl-C.

- [ ] **Step 6: Prova a vuoto del deploy**

Run: `npx wrangler deploy --dry-run`
Expected: nessun errore. In particolare, nessuna lamentela sul campo `name`.

⚠️ Se rifiuta `3dgame` perché inizia con una cifra: cambiare `"name"` in `"game3d"` in `wrangler.jsonc`, aggiornare il commento se necessario, e ricordarsene alla Task 5 (il nome del progetto sul dashboard deve combaciare).

- [ ] **Step 7: Commit**

```bash
git add wrangler.jsonc public/_headers
git commit -m "feat: configura il Worker ad asset statici e la cache"
```

---

### Task 3: CI

Il gioco ha una rete di sicurezza che vale più della build: `verify:levels` garantisce che nessun livello impossibile raggiunga il giocatore. Va eseguita a ogni pull request.

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `.nvmrc` (Task 1), gli script `build` e `verify` di `package.json`.
- Produces: un check di GitHub che rende verde o rossa una PR verso `master`.

- [ ] **Step 1: Creare `.github/workflows/ci.yml`**

```yaml
name: CI

# Verifica in sviluppo: gira sui push a develop e sulle PR verso develop/master.
# Il deploy NON passa da qui: lo fa Cloudflare al push su master (vedi DEPLOY.md).
# Il gate esiste comunque, ma solo se si pubblica passando da una pull request:
# la PR verso master è verde soltanto se le verifiche headless confermano che
# ogni livello generato è risolvibile.
on:
  push:
    branches: [develop]
  pull_request:
    branches: [master, develop]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm install --no-audit --no-fund
      - name: Build
        run: npm run build

      # La verifica più importante del progetto: fisica, occlusione, solver e
      # game loop sono pura logica e girano senza browser. `verify:levels` è la
      # rete che impedisce a un livello impossibile di arrivare in produzione.
      - name: Verifiche headless
        run: npm run verify
        timeout-minutes: 15
```

- [ ] **Step 2: Controllare la sintassi del workflow**

Run: `npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build e verifiche headless su PR e push a develop"
```

---

### Task 4: Documentazione

**Files:**
- Create: `DEPLOY.md`
- Modify: `README.md` (aggiungere una sezione *Pubblicazione* dopo la sezione *Verifiche*)

**Interfaces:**
- Consumes: `wrangler.jsonc` e `public/_headers` (Task 2), il workflow (Task 3).
- Produces: le istruzioni che la Task 5 esegue.

- [ ] **Step 1: Creare `DEPLOY.md`**

````markdown
# Deploy — Cloudflare Workers

Il gioco non ha un server: nessun database, nessuna variabile d'ambiente, nessun
segreto. È un bundle statico che Cloudflare serve dalla sua rete, e tutta la
logica — generazione dei livelli compresa — gira nel browser.

```text
3dgame.pallade.it   → Cloudflare Worker (solo asset statici)
GitHub Actions      → build e verifiche headless sulle pull request
```

Il codice va in produzione con un `git push` su `master`.

## 1. Il Worker

`wrangler.jsonc` alla root è la configurazione completa. Non ha un campo `main`
perché non c'è codice Worker da eseguire: solo `assets.directory` che punta a
`dist/`.

Due scelte meritano una spiegazione, perché si discostano da `../gym`:

- **`not_found_handling: "none"`.** gym usa `"single-page-application"` perché ha
  un router Vue e `/allenamento` non è un file. Qui non esistono rotte: il
  livello si sceglie con `?level=N`, che non tocca il path. Col fallback attivo
  un `.glb` mancante riceverebbe `index.html`, e l'errore arriverebbe al
  giocatore come un parse error incomprensibile invece che come un 404.

- **`public/_headers`.** Vite mette l'hash nel nome solo a ciò che passa dalla
  sua pipeline: `/assets/*` sì, `/models/*.glb` no, perché stanno in `public/` e
  vengono copiati tali e quali. Cache immutabile sui modelli significherebbe che
  un modello corretto non raggiunge più chi ha già visitato il sito. Da qui il
  giorno di `max-age` sui `.glb` e l'anno sugli asset con hash.

⚠️ **Non aggiungere un file `_redirects` con `/* /index.html 200`.** Con i Worker
ad asset statici `/index.html` viene normalizzato a `/`, che rientra in `/*` e
riparte; Cloudflare lo rileva e rifiuta il deploy con `Infinite loop detected in
this rule [code: 100324]` — dopo aver caricato gli asset, quindi il fallimento
arriva a build già riuscita.

## 2. Configurazione sul dashboard (una tantum)

**Workers & Pages → Create → Connect to Git**

| Impostazione | Valore |
| --- | --- |
| Repository | `gomutako/3dgame` |
| Production branch | `master` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Il nome del progetto deve combaciare col campo `name` di `wrangler.jsonc`,
altrimenti `wrangler deploy` crea un secondo Worker scollegato dal repo.

**Worker → Settings → Domains & Routes → Add Custom Domain** → `3dgame.pallade.it`

Il record DNS nella zona `pallade.it` **lo crea Cloudflare da sé** insieme al
Custom Domain: non va aggiunto a mano. Il certificato è automatico.

⚠️ Se per `3dgame.pallade.it` esiste già un record che punta altrove, l'aggiunta
del Custom Domain fallisce: va rimosso prima.

## 3. Rilascio

```bash
# dal branch di lavoro
npm run verify          # la rete di sicurezza sui livelli
git push origin develop

# aprire una PR develop → master: la CI deve essere verde
# il merge su master fa partire la build di Cloudflare
```

Il deploy di Cloudflare e la CI di GitHub sono binari separati: la CI **non**
blocca il deploy. Passando da una pull request il gate esiste comunque, perché
la PR è verde solo se `verify:levels` conferma che nessun livello è impossibile.
**Su un push diretto a `master` quel gate non c'è.**

Da locale, come ripiego:

```bash
npm run build && npx wrangler deploy
```

## 4. Verifiche dopo il rilascio

```bash
curl -sI https://3dgame.pallade.it/ | grep -i cache-control
# atteso: no-cache

curl -sI https://3dgame.pallade.it/models/Avocado.glb | grep -i 'cache-control\|content-type'
# atteso: public, max-age=86400  ·  model/gltf-binary (o application/octet-stream)

curl -so /dev/null -w '%{http_code}\n' https://3dgame.pallade.it/non-esiste
# atteso: 404 — conferma not_found_handling "none"
```

E a mano, **da telefono e non solo da desktop**, perché il gioco è pensato
mobile-first e il layout è adattivo:

- il livello 1 carica e gli oggetti sono texturizzati (bianchi = modelli non
  trovati)
- un tap prende un pezzo, il trascinamento gira la scatola
- `?level=12` salta al livello 12
````

- [ ] **Step 2: Aggiungere la sezione al README**

Inserire subito **prima** della sezione `## Struttura` di `README.md`:

```markdown
## Pubblicazione

Il gioco sta su **[3dgame.pallade.it](https://3dgame.pallade.it)**: un Worker
Cloudflare di soli asset statici, ricostruito a ogni push su `master`.
Configurazione e verifiche in **[DEPLOY.md](DEPLOY.md)**.
```

- [ ] **Step 3: Controllare i link relativi**

Run: `ls DEPLOY.md docs/superpowers/specs/2026-08-10-deploy-cloudflare-worker-design.md`
Expected: entrambi esistono, quindi i rimandi del README e del piano non sono rotti.

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md README.md
git commit -m "docs: istruzioni di deploy su Cloudflare"
```

---

### Task 5: Rilascio e verifica in produzione

Questa task ha passi manuali sul dashboard di Cloudflare: vanno eseguiti dall'utente, non automatizzati.

**Files:** nessuno (salvo correzioni emerse dalle verifiche).

**Interfaces:**
- Consumes: tutto ciò che le Task 1–4 hanno prodotto.
- Produces: `https://3dgame.pallade.it` funzionante.

- [ ] **Step 1: Portare il lavoro su `master`**

```bash
git push origin develop
```

Poi aprire una pull request `develop` → `master` su GitHub e attendere che la CI sia verde.

- [ ] **Step 2: Creare il progetto su Cloudflare**

Sul dashboard: **Workers & Pages → Create → Connect to Git**, repo `gomutako/3dgame`, production branch `master`, build command `npm run build`, deploy command `npx wrangler deploy`.

Il nome del progetto deve essere **identico** al campo `name` di `wrangler.jsonc` (`3dgame`, o il ripiego deciso nella Task 2 Step 6).

- [ ] **Step 3: Fare il merge e guardare la build**

Merge della PR su `master`. Cloudflare avvia build e deploy da sé.
Expected: build verde. Il Worker risponde sul suo `*.workers.dev`.

⚠️ Se la build fallisce per la versione di Node, impostare la variabile `NODE_VERSION` a `22` nelle impostazioni di build del progetto.

- [ ] **Step 4: Collegare il dominio**

**Worker → Settings → Domains & Routes → Add Custom Domain** → `3dgame.pallade.it`.

Non aggiungere record DNS a mano: li crea Cloudflare. Attendere l'emissione del certificato (di solito meno di un minuto).

- [ ] **Step 5: Verifiche automatiche**

```bash
curl -sI https://3dgame.pallade.it/ | grep -i cache-control
curl -sI https://3dgame.pallade.it/models/Avocado.glb | grep -i 'cache-control\|content-type'
curl -so /dev/null -w '%{http_code}\n' https://3dgame.pallade.it/non-esiste
```

Expected: `no-cache` · `public, max-age=86400` · `404`.

Se gli header sui modelli non ci sono, `_headers` non è finito in `dist/`: controllare che stia in `public/` e non alla root.

- [ ] **Step 6: Verifiche a mano, anche da telefono**

- il livello 1 carica; gli oggetti sono texturizzati e non bianchi
- un tap prende un pezzo e lo porta nel vassoio; tre uguali fanno *pop*
- il trascinamento gira la scatola
- `https://3dgame.pallade.it/?level=12` parte dal livello 12

- [ ] **Step 7: Allineare `develop`**

```bash
git checkout develop
git merge --ff-only master
git push origin develop
```

---

## Nota fuori piano

`origin/HEAD` punta a `main`, che non ha alcun ruolo in questo flusso: chi apre il repo su GitHub atterra su un branch che non è quello pubblicato. Va sistemato separatamente — non fa parte di questo piano e non blocca nulla.
