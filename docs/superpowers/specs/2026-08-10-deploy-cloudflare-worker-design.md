# Pubblicazione su Cloudflare Worker — `3dgame.pallade.it`

Data: 2026-08-10 · Stato: approvato, da implementare

## 1. Obiettivo

Pubblicare il prototipo su `https://3dgame.pallade.it`, terzo livello di dominio
della zona `pallade.it`, già ospitata su Cloudflare dal progetto `../gym`.

Il modello di riferimento è `gym`: un Worker di **soli asset statici**, senza codice
Worker, distribuito da Cloudflare a ogni push sul branch di produzione.

**Fuori scope**, dichiarato per evitare deriva: nessun livello di gioco nuovo, nessuna
modifica a `src/` — con l'unica eccezione di un `vite.config.js` se la build lo impone
(vedi §5).

## 2. Perché è più semplice di gym

3dgame non ha backend, database, autenticazione, posta, variabili d'ambiente né router
client-side. Tutta la logica sta nel browser e un livello è funzione di `(seed, numero)`.
Restano solo file statici da servire.

Tre cose di gym **non** vanno copiate, e il perché conta più della differenza:

| gym | 3dgame | motivo |
|---|---|---|
| `not_found_handling: "single-page-application"` | `"none"` | gym ha un router Vue: `/allenamento` non è un file e senza fallback darebbe 404. Qui non esistono rotte client — solo il parametro `?level=N`, che non tocca il path. Con il fallback attivo, un `.glb` mancante riceverebbe `index.html` al posto di un 404, e l'errore arriverebbe al giocatore come un parse error incomprensibile invece che come «file non trovato». |
| `_headers` per `sw.js`, manifest, universal link | `_headers` per `/models/*` | vedi §4 |
| workspace `frontend/`, `assets.directory: ./frontend/dist` | root singola, `./dist` | il progetto non ha workspace |

## 3. `wrangler.jsonc`

Alla root. Nessun campo `main`: non c'è codice Worker da eseguire.

```jsonc
{
  "name": "3dgame",
  "compatibility_date": "2026-08-10",

  "assets": {
    "directory": "./dist",
    "not_found_handling": "none"
  },

  "observability": { "enabled": true }
}
```

Il campo `name` decide **su quale Worker** distribuisce `wrangler deploy` e va tenuto
allineato al nome del progetto sul dashboard: un nome diverso creerebbe un secondo
Worker scollegato dal repo. Determina anche il sottodominio `*.workers.dev`, non il
dominio pubblico, che è un Custom Domain separato (§7).

⚠️ **Rischio noto: il nome inizia con una cifra.** Se Cloudflare rifiuta `3dgame`,
ripiegare su `tdg` o `game3d`. Il dominio pubblico non ne risente in alcun modo.

I commenti nel file vanno scritti come quelli di `gym/wrangler.jsonc`: spiegano perché
una scelta è quella e cosa si romperebbe altrimenti, non cosa fa il campo.

## 4. Cache — `public/_headers`

Il punto meno ovvio dell'intero deploy.

Vite mette l'hash nel nome **solo** a ciò che passa dalla sua pipeline. `/assets/*` sì;
`/models/*.glb` **no**, perché stanno in `public/` e vengono copiati tali e quali. Una
cache immutabile sui modelli significherebbe che un `.glb` corretto non raggiunge più
chi ha già visitato il sito, per un anno, senza modo di forzare l'aggiornamento.

```
/index.html          Cache-Control: no-cache
/assets/*            Cache-Control: public, max-age=31536000, immutable
/models/*            Cache-Control: public, max-age=86400
```

Un giorno sui modelli è il compromesso scelto: 3,5 MB non riscaricati a ogni partita, e
una modifica si propaga da sola entro 24 ore senza intervento.

`_headers` è letto anche dai Worker ad asset statici, non solo da Pages: in `gym` è già
in produzione e funziona.

**Miglioramento possibile, deliberatamente rimandato:** far passare i `.glb` dalla
pipeline Vite (`import.meta.glob` con `?url`) darebbe anche a loro un nome con hash e
quindi la cache eterna, corretta per costruzione. Richiede però di cambiare
`src/scene/shapes.js`, che oggi costruisce l'URL a mano (`${base}${m.file}.glb`). È un
lavoro pulito ma indipendente dalla pubblicazione, e va fatto dopo.

⚠️ **Non usare un file `_redirects` con `/* /index.html 200`.** Con i Worker ad asset
statici `/index.html` viene normalizzato a `/`, che rientra in `/*` e riparte;
Cloudflare lo rileva e rifiuta il deploy con `Infinite loop detected in this rule
[code: 100324]` — dopo aver caricato gli asset, quindi il fallimento arriva a build già
riuscita. (Lezione ereditata da `gym`.)

## 5. Build

- `.nvmrc` con `22`, come `gym`.
- `npm run build` produce `dist/`, già in `.gitignore`.
- `base` di Vite resta il default `/`: il sito sta alla radice del sottodominio.

⚠️ **Primo passo dell'implementazione: verificare che la build passi davvero.**
`src/main.js:22` contiene un **top-level await** (`await loadItemTypes()`). Se il target
di default di Vite 8 non lo copre, la build fallisce con un errore esplicito sul target.
Solo in quel caso si aggiunge un `vite.config.js` con `build.target` alzato. Non va
creato preventivamente: una config che non serve è una config che poi nessuno sa perché
c'è.

Non serve invece alcuna configurazione per il wasm di Rapier:
`@dimforge/rapier3d-compat` lo incapsula in base64 dentro il bundle JS, quindi non
esiste un asset `.wasm` da servire e non c'è alcun problema di MIME type.

I 3,5 MB di modelli stanno larghi nei limiti degli asset statici (20 MiB per file,
20.000 file).

## 6. CI — `.github/workflows/ci.yml`

Ricalca `gym/.github/workflows/ci.yml`:

- trigger: push su `develop`, pull request verso `master` e `develop`
- Node 22, `cache: npm`
- `npm install --no-audit --no-fund`
- `npm run build`
- `npm run verify` — le tre verifiche headless: livelli generati risolvibili,
  playthrough automatico, booster

Workers Builds e la CI sono **binari separati**: la CI non blocca il deploy. Il gate
esiste comunque, ma solo se si pubblica passando da una pull request verso `master` —
la PR è verde soltanto se `verify:levels` conferma che nessun livello impossibile
raggiunge il giocatore. **Su un push diretto a `master` quel gate non c'è.** È una
conseguenza accettata della scelta di Workers Builds al posto di una pipeline unica su
GitHub Actions, non una svista.

## 7. Configurazione sul dashboard (manuale)

1. **Workers & Pages → Create → Connect to Git** → repo `gomutako/3dgame`
   - production branch: **`master`**
   - build command: `npm run build`
   - deploy command: `npx wrangler deploy`
2. **Worker → Settings → Domains & Routes → Add Custom Domain** → `3dgame.pallade.it`

Il record DNS nella zona `pallade.it` lo crea Cloudflare da sé insieme al Custom Domain:
**non va aggiunto a mano**, e un record preesistente per quel nome che punta altrove
impedirebbe l'operazione. Il certificato è automatico.

## 8. Documentazione

- `DEPLOY.md` nuovo, corto: qui non ci sono database, migrazioni, posta né app iOS.
  Deve contenere i passi del §7, la checklist di rilascio e le verifiche del §9.
- README: una sezione *Pubblicazione* che rimanda a `DEPLOY.md`.

## 9. Verifiche

**Prima del deploy, in locale:**

```bash
npm install
npm run build
npm run verify          # rete di sicurezza sui livelli
npx wrangler dev        # serve dist/ come lo servirà Cloudflare
```

**Dopo il deploy:**

- `https://3dgame.pallade.it` carica e il livello 1 è giocabile
- `?level=12` salta al livello 12
- gli header sono quelli attesi:

```bash
curl -sI https://3dgame.pallade.it/models/Avocado.glb | grep -i 'content-type\|cache-control'
curl -sI https://3dgame.pallade.it/ | grep -i cache-control
```

- un path inesistente risponde **404**, non `index.html` (conferma il `"none"` del §3)
- rotazione della scatola e presa di un pezzo funzionano da telefono, non solo da
  desktop: il gioco è pensato mobile-first e il layout è adattivo
