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

⚠️ **La regola sul punto d'ingresso va scritta su `/`, non su `/index.html`.**
Cloudflare normalizza il secondo nel primo con un **307**: una regola su
`/index.html` finisce sul redirect e non sulla pagina, e il `no-cache` non arriva
mai dove serve. Verificato con `wrangler dev`:

```
$ curl -sI http://localhost:8787/index.html
HTTP/1.1 307 Temporary Redirect
Location: /
```

⚠️ **Non aggiungere un file `_redirects` con `/* /index.html 200`.** È la stessa
normalizzazione vista da un'altra angolazione: `/index.html` diventa `/`, che
rientra in `/*` e riparte. Cloudflare lo rileva e rifiuta il deploy con
`Infinite loop detected in this rule [code: 100324]` — dopo aver caricato gli
asset, quindi il fallimento arriva a build già riuscita.

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

⚠️ Il nome `3dgame` **inizia con una cifra**. `wrangler deploy --dry-run` non lo
contesta, ma il dry-run non chiama l'API: se il primo deploy vero lo rifiuta,
ripiegare su `game3d` **sia** in `wrangler.jsonc` **sia** sul dashboard. Il
dominio pubblico non ne risente: `name` determina solo il sottodominio
`*.workers.dev`.

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
# atteso: public, max-age=86400  ·  model/gltf-binary

curl -sI https://3dgame.pallade.it/assets/ | head -1
# gli asset con hash: atteso public, max-age=31536000, immutable
# (il nome esatto del file cambia a ogni build: prenderlo da dist/assets/)

curl -so /dev/null -w '%{http_code}\n' https://3dgame.pallade.it/non-esiste
# atteso: 404 — conferma not_found_handling "none"
```

E a mano, **da telefono e non solo da desktop**, perché il gioco è pensato
mobile-first e il layout è adattivo:

- il livello 1 carica e gli oggetti sono texturizzati (bianchi = modelli non
  trovati)
- un tap prende un pezzo, il trascinamento gira la scatola
- `?level=12` salta al livello 12

## 5. Prova in locale, prima di pubblicare

`wrangler dev` serve `dist/` esattamente come lo servirà Cloudflare — `_headers`
compreso, cosa che `vite preview` non fa:

```bash
npm run build
npx wrangler dev        # http://localhost:8787
```
