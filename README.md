# 3DG — Triple Match 3D

Puzzle a tap: una massa di oggetti 3D caduti in una scatola, 5 scomparti in basso,
tre uguali spariscono. Scomparti pieni → sconfitta. Scatola vuota → livello successivo.

**Tocca** un pezzo per prenderlo, **trascina** per girare la scatola e vedere sotto.

Progetto e ragionamento dietro le meccaniche: **[DESIGN.md](DESIGN.md)**.

## Avvio

```bash
npm install
npm run dev          # http://localhost:5173
```

`?level=12` nell'URL salta direttamente a un livello (comodo per il tuning).

## Verifiche

Girano senza browser: fisica, occlusione, solver e game loop sono pura logica.

```bash
npm run verify              # tutte e tre
npm run verify:levels 1 30  # ogni livello è generato risolvibile e bilanciato
npm run verify:play 1 20    # un giocatore automatico porta a termine i livelli
npm run verify:play 1 20 --ruota   # idem, girando la scatola fra una presa e l'altra
npm run verify:boosters 9   # undo, hint, shuffle
npm run verify:physics 1 12 # assestamento, occlusione, nessun pezzo nel fondo
```

`verify:levels` è la rete di sicurezza più importante: un livello impossibile
non deve mai raggiungere il giocatore. Rilanciala dopo ogni modifica a
`src/level/`, a `src/scene/setup.js` (l'inquadratura definisce l'occlusione)
o alla curva di difficoltà.

## Aggiungere un oggetto

I modelli stanno in `public/models/` come `.glb` singoli, con le texture dentro.
**Copiarne uno lì dentro basta**: l'elenco lo rigenera `scripts/sync-models.mjs`
prima di `dev`, `build` e `verify`, e ogni livello pesca la sua tavolozza fra
quelli disponibili.

Un file scaricato dal web quasi mai rispetta i limiti — casi reali incontrati:
98.000 triangoli, e 21,8 MB di texture 2048².

```bash
npm run prepare-model ~/Downloads/Fragola.obj fragola   # converte, decima, riduce
npm run check-model public/models/fragola.glb           # solo il referto
```

Entrano in gioco **solo** i modelli che passano `check-model`; gli altri vengono
esclusi con la motivazione. Licenza e leggibilità della silhouette restano
giudizio umano: gli strumenti misurano il resto.

## Pubblicazione

Il gioco sta su **[3dgame.pallade.it](https://3dgame.pallade.it)**: un Worker
Cloudflare di soli asset statici, ricostruito a ogni push su `master`.
Configurazione e verifiche in **[DEPLOY.md](DEPLOY.md)**.

## Struttura

```text
src/
  core/    rng deterministico · tween · curva di difficoltà
  scene/   renderer, luci, scatola, camera · caricamento dei modelli
  level/   mondo fisico vivo · grafo di occlusione · assegnazione tipi · solver
  game/    vassoio (5 slot, match) · macchina a stati, input, animazioni, booster
  ui/      HUD
scripts/   verifiche headless (headless.mjs fa girare il gioco senza browser)
public/    i modelli .glb con texture PBR (Khronos — licenze in CREDITS.md)
```

Un livello è funzione di `(seed, numero livello)`: stesso input, stesso livello.

## Stato

Prototipo giocabile e verificato: generazione garantita risolvibile, pila con fisica
viva su forme reali (togli un pezzo e quelli sopra vengono giù), oggetti 3D veri,
scatola ruotabile col trascinamento,
grafo di occlusione ricostruito e posizione rivalidata a ogni assestamento e rotazione, ciclo completo vittoria/sconfitta, tre
booster, layout adattivo verticale e orizzontale.
Manca quanto elencato in [DESIGN.md §8](DESIGN.md) — audio, mesh autoriali,
progressione a stelle, wrapping iOS.
