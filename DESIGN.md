# 3DG — Triple Match 3D · Game Design & Technical Design

## 1. Fantasia e core loop

Una scatola aperta piena di oggetti 3D caduti alla rinfusa. Sotto, 5 scomparti.
Tocchi un oggetto → vola nello scomparto. Tre uguali → *pop*, scomparti liberi.
Scomparti pieni → hai perso. Scatola vuota → livello successivo.

```text
DROP (regia) → PLAYING ⇄ [pick → tray → match?] → WIN → livello+1
                   └────────── tray pieno ──────→ LOSE → retry
```

Sessione target: 45–90 secondi per livello. Un solo gesto (tap). Nessun timer:
la tensione nasce dallo spazio, non dall'orologio.

## 2. Regole formali

| Elemento | Regola |
|---|---|
| Oggetti | `N = 3 × T` (T = numero di triplette). Ogni tipo compare in multipli di 3 |
| Selezione | Solo l'oggetto **in cima al raycast** dalla camera. Ciò che è coperto non è cliccabile |
| Rotazione | Trascinando si gira la scatola attorno all'asse verticale: cambia cosa è in cima, non cosa c'è |
| Pila | **Frana**: togliere un pezzo sveglia i vicini, che cadono e si riassestano (vedi §5) |
| Vassoio | 5 slot. Inserimento **auto-raggruppante**: il pezzo si posiziona accanto ai suoi simili |
| Match | 3 dello stesso tipo → rimossi, gli altri compattano a sinistra |
| Sconfitta | Un pezzo entra senza formare una tripletta e occupa il quinto slot |
| Vittoria | 0 oggetti nella scatola |

**Perché 5 slot e non 7 (standard del genere):** con S slot puoi tenere al massimo
S−1 tipi "aperti" prima di essere costretto a chiudere. A 5 il margine di errore è
di 4 tipi: molto più teso. È una scelta valida ma richiede una generazione dei
livelli *garantita risolvibile*, altrimenti diventa frustrante (vedi §4).

## 3. Curva di difficoltà

Tre leve indipendenti, non solo "più oggetti":

| Leva | L1 | L10 | L25 | tetto | Effetto |
|---|---|---|---|---|---|
| Triplette `T` | 7 | 15 | 25 | 30 | Durata + profondità della pila |
| Tipi distinti `K` | 3 | 8 | 12 | 12 | Pressione sul vassoio |
| **Spread `W`** | 2,4 | 9,1 | 16 | 16 | Quanto sono "lontane" fra loro le tre copie di una tripletta nell'ordine di sfoltimento |

`W` è la vera difficoltà: misura quanti pezzi *inutili* devi tenere in mano prima
di chiudere una tripletta. È la leva che rende un livello "pensato" e non solo lungo.
Ogni 5 livelli un livello **respiro** (`W` dimezzato) per il ritmo — L10 e L25 sono
livelli respiro, quindi il loro `W` effettivo è la metà di quello in tabella.

Numeri esatti in `src/core/levels.js`; `npm run verify:levels` li stampa livello per livello.

## 4. Generazione dei livelli — garanzia di risolvibilità

Il punto tecnico centrale. Pipeline in 5 fasi:

**1 · Simulazione headless, e una circolarità da sciogliere.** I collider seguono
la forma vera (scafo convesso), la forma *è* il tipo, e i tipi si decidono guardando
la pila… che dipende dai collider. Si scioglie in due tempi: una prima caduta con
collider uniforme dà una pila provvisoria indipendente dai tipi; assegnati i tipi,
si montano gli scafi veri e **la caduta si rifà da capo** dalla griglia di spawn.
(Scambiare i collider su una pila già posata no: le compenetrazioni sparano i pezzi
fuori dalla scatola.) Ogni frame è registrato per il replay.

**2 · Grafo di occlusione esatto.** Dalla camera di gioco lancio ~2000 raggi su una
griglia in screen-space; per ogni raggio ottengo la lista dei pezzi colpiti *in ordine
di profondità* (test raggio/sfera, non triangoli: costa nulla).
Un pezzo è **libero** ⟺ esiste un raggio in cui è il primo non ancora rimosso.
Questo modella la cliccabilità reale invece di approssimarla con "chi sta più in alto".

**3 · Ordine di sfoltimento.** Sfoglio ripetutamente l'insieme libero → una
permutazione `O` che è per costruzione un ordine di rimozione legale.

**4 · Assegnazione dei tipi.** Perturbo `O` localmente con finestra `W`
(`key = i + rand(−W, W)`, riordino) e taglio in triplette consecutive.
Con `W = 0` la soluzione è banale (tieni ≤3 pezzi in mano): **sempre risolvibile**.
`W` cresce → serve pianificare. È il parametro di difficoltà del §3.

**5 · Validazione.** Un solver greedy randomizzato (priorità: completa una tripletta >
accoppia > apri un tipo nuovo solo se resta spazio) prova 24 volte con 5 slot.
Se fallisce, riduco `W` e riprovo; il fallback `W = 0` è una garanzia matematica.

**6 · In partita: la garanzia si rinnova.** (vale anche per la rotazione: il grafo
dipende dall'angolo, quindi si rifà quando la scatola si ferma) La pila frana, quindi il grafo della fase 2
scade a ogni rimozione. Appena i corpi rigidi tornano a dormire lo **ricostruisco** sulle
pose nuove (~5 ms) e **rivalido** la posizione tenendo conto del vassoio. Se una frana
avesse chiuso ogni strada, i tipi dei pezzi rimasti vengono ridistribuiti d'ufficio
(«riassetto automatico») invece di lasciare il giocatore in una posizione morta.
**Nessun livello impossibile può raggiungere il giocatore, nemmeno dopo una frana.**

## 5. Decisioni di design non ovvie

- **Fisica viva per tutto il livello.** Il mondo Rapier non si spegne dopo la caduta:
  togliere un pezzo toglie il suo corpo rigido e sveglia i vicini, che franano. È ciò che
  rende la pila una *massa* e non un diorama. Il prezzo è che il grafo di occlusione
  scade in continuazione — pagato ricostruendolo a ogni assestamento (§4.6). Il costo
  reale è ~5 ms per frana: la garanzia di risolvibilità sopravvive alla fisica invece di
  essere sacrificata a essa.
- **Ruota la scatola, non la telecamera.** Orbitare la camera porterebbe il vassoio
  fuori scena; invece gira un gruppo "arena" che contiene scatola e pila, mentre camera,
  luci e vassoio restano fermi. La fisica non ruota affatto: per proiettare le pose
  fisiche basta ruotare la camera dell'angolo opposto. L'inquadratura è calcolata sul
  cilindro che contiene la scatola a *qualunque* angolo, così girando non si taglia nulla.
- **Ruotare aggiunge opzioni, non le toglie.** Un pezzo raggiungibile da un angolo lo
  resta: si può sempre tornare indietro. Per questo, prima di dichiarare morta una
  posizione, la rivalidazione prova anche gli altri tre quarti di giro.
- **Il suggerimento spareggia, non scavalca.** Fra mosse di pari valore preferisce quella
  che il dito prende al primo colpo (il grafo usa sfere, un cono ha silhouette più
  piccola). Ma non scarta mai una mossa migliore per questo: scavalcare farebbe deviare
  il giocatore dalla strategia che il solver ha validato — provato, e il livello si perde.
- **La frana ha una rete, non un'eccezione.** Se la rivalidazione dice che la posizione
  è morta, il gioco ridistribuisce i tipi rimasti da solo. Nelle partite automatiche di
  `npm run verify:play` (livelli 1–22, una frana per ogni presa) non è ancora servito
  nemmeno una volta: è una rete, non una stampella.
- **Forma + colore ridondanti.** Ogni tipo ha silhouette e colore distinti: leggibile
  per daltonici e a colpo d'occhio su schermo piccolo. I 12 modelli sono scelti fra i
  campioni glTF di Khronos passando tre filtri — licenza, compattezza e peso in
  scena — e **ordinati per contrasto decrescente**: un livello usa i primi N tipi,
  quindi in testa vanno quelli che si distinguono di più.
- **Il peso in scena è un criterio di scelta, non un dettaglio.** Con 60 pezzi in
  scatola, un modello da 100.000 triangoli ne fa 6 milioni per fotogramma: due
  candidati sono stati scartati per questo, prima che per l'estetica.
- **Le texture sono ridotte a 256².** Erano 59 MB a 2048²; a questa distanza la
  differenza non si vede e il gioco pesa 3,5 MB invece di 60.
- **Collisione sulla forma vera, non su una scatola.** Ogni tipo ha per collider lo
  scafo convesso *arrotondato* del suo modello: un cono si comporta da cono, e niente
  resta appollaiato sulla punta di qualcosa. L'arrotondamento non è cosmetico — con
  scafi a spigolo vivo i contatti vibrano e la pila non si addormenta mai.
- **Il collider uniforme sopravvive solo come impalcatura**, per la prima caduta: serve
  una pila che non dipenda ancora dai tipi. Poi si butta.
- **La scatola è dimensionata sull'area davvero occupata**, misurata, non su una
  scacchiera teorica: con forme reali i pezzi si incastrano e in uno strato ce ne
  stanno molti più del previsto — la pila verrebbe piatta e senza occlusione,
  cioè senza puzzle. Con la taratura attuale resta coperto circa un terzo dei pezzi.
- **Auto-raggruppamento nel vassoio.** Ridurre il carico cognitivo: il giocatore conta
  gruppi, non posizioni.
- **La scatola si dimensiona sul numero di pezzi**, per tenere la pila sui ~3 strati.
  A scatola fissa i primi livelli sarebbero un unico strato piatto: nessuna occlusione,
  quindi nessun puzzle. È la sovrapposizione a fare il gioco, non la quantità.
- **Inquadratura calcolata, non tarata a mano.** La camera risolve iterativamente la
  distanza che tiene dentro pila, scatola e vassoio (con margine sotto per i pulsanti).
  Vale per qualsiasi proporzione di schermo — e siccome il grafo di occlusione nasce
  da questa camera, l'ordine è vincolante: misure → camera → generazione.
- **La sconfitta è decisa nella logica, non in una callback di animazione.** Un tween
  ucciso o saltato non deve poter far sopravvivere il giocatore; il verdetto è già
  preso quando il quinto pezzo parte, l'animazione ne ritarda solo la comunicazione.

## 6. Booster

| Booster | Effetto | Costo design |
|---|---|---|
| **Undo** | Rimette nella pila l'ultimo pezzo preso. Storia azzerata a ogni match | Toglie la punizione da tap accidentale |
| **Shuffle** | Ripermuta i tipi dei pezzi rimasti, ri-validando la risolvibilità col vassoio attuale | Rete di sicurezza, 1 per livello |
| **Hint** | Evidenzia il pezzo libero migliore (chiude una tripletta / apre la più promettente) | Insegna la strategia invece di risolverla |

## 7. Architettura

```text
src/
  core/    rng (seeded, livelli riproducibili) · tween · levels (curva §3)
  scene/   setup (renderer, luci, camera, scatola) · shapes (12 tipi procedurali)
  level/   simulate (Rapier headless + registrazione) · occlusion (§4.2)
           assign (§4.4) · solver (§4.5) · generate (orchestrazione)
  game/    tray (5 slot, match, sconfitta) · game (FSM, input, animazioni, booster)
  ui/      hud
```

Il livello è definito da un **seed**: `(seed, numero livello)` → livello identico.
Utile per debug, per la condivisione e per un futuro "livello del giorno".

## 8. Roadmap oltre il prototipo

1. Audio: pop del match, tonfo della caduta, scala musicale crescente sulle triplette
2. Progressione: stelle per livello, un kit di modelli diverso ogni 10 livelli
3. Wrapping iOS: WKWebView / Capacitor, `viewport-fit=cover`, target 60fps su A12
4. Telemetria: tasso di fallimento per livello → auto-tuning di `W`
