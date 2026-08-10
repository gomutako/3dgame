# Fisica più leggera e apertura a nuovi modelli

Data: 2026-08-10 · Stato: approvato, da implementare

## 1. Le due richieste

1. «Che gli oggetti fossero meno pesanti» — chiarito: **peso fisico**, come si
   muovono. Non byte.
2. «Che ci fossero molti più oggetti 3D» — i modelli li cerca l'utente sul web.
   Serve quindi la **specifica** a cui devono rispondere, non una selezione.

Sono lavori indipendenti — costanti di simulazione da una parte, pipeline di
asset dall'altra — e restano separati. Questa spec copre **la Parte 1 per
intero** e, della Parte 2, **solo lo strumento che permette all'utente di
cercare i modelli senza sprecare tempo**. L'integrazione dei modelli e la
ritaratura della curva di difficoltà saranno una spec a sé, quando i file
esisteranno.

## 2. Perché la massa non c'entra

Va detto perché è la trappola naturale: in un corpo rigido la massa **non**
cambia la velocità di caduta. Abbassare la densità dei collider non produrrebbe
alcun effetto visibile. Ciò che oggi legge come «pesante» sono tre proprietà
diverse, tutte in `src/level/physics.js`:

| costante | oggi | comunica |
|---|---|---|
| gravità del mondo | −32 | 3,3× quella terrestre: tutto precipita |
| `restitution` | 0,02 (scafi) / 0,03 (cuboide) | zero rimbalzo, tonfo morto |
| `linearDamping` / `angularDamping` | 0,25 / 0,7 | il moto muore subito, niente rotolamento |
| `friction` | 0,9 (scafi) / 0,85 (cuboide) | gli oggetti si incollano invece di scivolare |

## 3. Valori proposti — punto di partenza, non verdetto

Obiettivo dichiarato: **terrestre e vivace**.

| costante | oggi | proposta |
|---|---|---|
| gravità | −32 | **−16** |
| `restitution` | 0,02 / 0,03 | **0,20** |
| `linearDamping` | 0,25 | **0,05** |
| `angularDamping` | 0,7 | **0,25** |
| `friction` | 0,9 / 0,85 | **0,65** |
| `DROP_STEPS` | 420 | alzarlo finché `settleAndRecord()` esce **per addormentamento e non per esaurimento dei passi**, sul livello più affollato (25 triplette) |

Questi numeri sono un'ipotesi da tarare contro le misure del §4, non un
risultato. La taratura finale la decidono le metriche.

## 4. I due rischi, e come si misurano

Il punto tecnico centrale di questa spec: **le costanti non si scelgono a
occhio.** Due grandezze si degradano nella direzione opposta a quella voluta, e
vanno strumentate prima di toccare i valori.

### 4.1 Il ritmo

Il grafo di occlusione si ricostruisce **solo a pila ferma**
(`game.js`, `pendingSettle`). Un assestamento più lungo diventa attesa fra una
presa e l'altra. E il `forceSleep` d'ufficio a `MAX_AWAKE = 2,5 s` scatterebbe
più spesso — lo stesso meccanismo che ha prodotto il bug delle compenetrazioni
(commit `ff9dde6`), quindi non è un dettaglio innocuo.

**Metrica:** frame di assestamento per presa, mediana e massimo, per livello.

### 4.2 Il puzzle

Il rischio serio, e non ovvio. Meno attrito e più rimbalzo producono una pila
**più piatta**. `DESIGN.md` §5 è esplicito: il gioco funziona perché resta
coperto **circa un terzo** dei pezzi — «è la sovrapposizione a fare il gioco,
non la quantità». Una pila sparpagliata è più piacevole da guardare e **meno
gioco**.

**Metrica:** frazione di pezzi occlusi a pila ferma, cioè quelli che il grafo di
occlusione **non** dichiara liberi.

**Soglia di accettazione:** se l'occlusione scende sotto il **25%** i valori
vanno corretti. L'attrito è la leva che la governa di più, la gravità la seconda.

### 4.3 Dove vivono le misure

Estensione di `scripts/verify-physics.mjs`, che già esiste, già gira in
`npm run verify` e quindi in CI. Aggiunge due colonne al suo tabulato e mantiene
il controllo che ha oggi (nessun pezzo sotto il piano della scatola).

Le tre suite esistenti restano il vincolo di correttezza: `verify:levels` deve
continuare a garantire che ogni livello sia risolvibile, `verify:play` che un
giocatore automatico lo porti a termine.

### 4.4 Procedura

1. Misurare il **baseline** con le costanti attuali e registrarne i numeri.
2. Applicare i valori del §3.
3. Rimisurare e confrontare.
4. Correggere i valori finché ritmo e occlusione stanno nei limiti.
5. Riportare all'utente la tabella prima/dopo, non solo l'esito.

## 5. Parte 2 — specifica dei modelli

L'utente cerca i file da sé. Questa sezione è il contratto che devono rispettare,
dedotto dal codice che li carica (`src/scene/shapes.js`), non da regole generiche.

### 5.1 Formato

**`.glb`** — glTF 2.0 binario, **file singolo con le texture incorporate**. Non
`.gltf` con cartella di risorse: il gioco fa una fetch per modello, da
`/models/<Nome>.glb`.

### 5.2 Ciò di cui l'autore non deve preoccuparsi

- **La scala è irrilevante.** `normalize()` centra la geometria e la riscala
  perché la sfera contenitiva valga sempre `ITEM_RADIUS` (0,44).
- **Più mesh vanno bene.** `flatten()` le fonde in una sola; i materiali
  diventano un array con un gruppo di geometria ciascuno.
- **L'orientamento è irrilevante:** i pezzi cadono con rotazione casuale.

### 5.3 Requisiti veri

| requisito | valore | perché |
|---|---|---|
| proporzioni | lato lungo / lato corto **≤ 2** | `normalize()` usa la sfera contenitiva: un oggetto lungo e piatto diventa minuscolo negli assi corti, si legge male e in un mucchio si comporta diversamente. È il motivo per cui lanterna e pesce erano stati scartati |
| triangoli | **≤ 8.000**, ideale ≤ 4.000 | 60 pezzi in scatola. ChronographWatch e ToyCar (100.000 l'uno) scartati per questo prima che per l'estetica |
| texture | **≤ 256×256** | oltre è sprecato a questa distanza; sopra si riducono in fase di integrazione |
| licenza | **CC0** o CC BY, **senza logo né marchi** | i due attuali con logo UX3D/Khronos vanno comunque sostituiti se il gioco diventa un prodotto (`CREDITS.md`) |
| UV | presenti se il modello ha texture | senza UV il codice ne inventa di nulle e il modello pesca il colore da un solo texel |
| silhouette e colore | distinti dai tipi già presenti | forma *e* colore ridondanti: leggibile per daltonici e su schermo piccolo |

### 5.4 Lo strumento

`npm run check-model <file.glb>` — verifica un candidato e stampa, riga per riga
con verdetto passa/non passa: triangoli, proporzioni della bounding box, numero
e dimensione delle texture, materiali, peso del file. Esce con codice diverso da
zero se un requisito **obbligatorio** non è rispettato.

Serve a evitare il ciclo «trovo dieci modelli, otto vanno buttati dopo
l'integrazione».

Non fa parte di questo strumento il giudizio su silhouette e colore: è
percettivo, lo dà l'occhio.

## 6. Cosa questa spec NON fa

- Non aggiunge modelli: non esistono ancora i file.
- Non alza `TYPE_COUNT` e non tocca `src/core/levels.js`.
- Non tocca la pipeline di riduzione delle texture.

Va però registrato ora, perché condiziona il lavoro futuro: alzare `TYPE_COUNT`
non è gratis. `levelConfig` calcola
`types = min(TYPE_COUNT, triples, 3 + ⌊n/1,8⌋)`, quindi con 20 modelli il
livello 25 passerebbe da 12 a **16 tipi distinti** contro 5 soli scomparti.
Resta risolvibile per costruzione (il fallback `W = 0` è una garanzia
matematica), ma diventa sensibilmente più difficile: la ritaratura della curva
sarà parte della spec di integrazione, con `verify:play` a dire se la difficoltà
è ancora umana.

Da correggere in quella sede anche un residuo storico: `DESIGN.md` §3 e §5
parlano di **12 modelli**, numero ereditato dal Food Kit di Kenney che il gioco
usava prima (`CREDITS.md`). I modelli Khronos di oggi sono **6**, e la tabella
della curva di difficoltà promette una varietà che il codice non può erogare —
`types` è tappato a 6 dal livello 6 in poi, quindi **una delle tre leve di
difficoltà è ferma da metà curva**.

## 7. Verifiche

```bash
npm run verify            # le quattro suite, compresa verify-physics estesa
npm run verify:physics    # ritmo, occlusione, nessun pezzo sotto il piano
npm run check-model <f>   # un candidato modello
```

A giudizio finale, però, la fisica la decide l'occhio: la tabella dice se il
gioco è ancora giocabile, non se la caduta è piacevole. Serve una prova a mano
dell'utente prima di considerare chiusa la Parte 1.
