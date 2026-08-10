# Crediti

## Modelli 3D

Gli oggetti che cadono nella scatola vengono dai **glTF Sample Assets** di
**Khronos** — [github.com/KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets).

| Modello | Autore | Licenza |
|---|---|---|
| Avocado | Public | CC0 1.0 |
| BoomBox | Public | CC0 1.0 |
| WaterBottle | Public | CC0 1.0 |
| Corset | UX3D | CC0 1.0 |

AntiqueCamera e SunglassesKhronos sono stati rimossi dal set: contenevano i logo
di UX3D e Khronos, marchi dei rispettivi titolari anche se il modello è CC0/CC BY.

## ⚠️ Modelli di provenienza non verificata

Aggiunti il 2026-08-11 scaricandoli dal web. **Autore, origine e licenza non
sono stati accertati**, ed è una scelta consapevole di chi sviluppa, non una
dimenticanza: serviva variare il set in fretta durante la messa a punto.

| Modello |
|---|
| 3d_demo_30 |
| Hex-Dumbell |
| Rubik |
| TEA |
| flashlight |
| lantern |
| mastertux-cup-209 |
| mastertux-vase-1546 |
| mastertux-water-polo-62 |
| tiny_planet_friends_3d-packaging-2922 |
| vase |
| wings_of_freedom-bell-3055 |

**Cosa comporta.** Il gioco è pubblicato su un sito pubblico, quindi ridistribuisce
questi file a chiunque lo apra. Finché resta un prototipo personale il rischio è
basso; **prima di farne un prodotto** — o di metterlo su uno store — ogni riga qui
sopra va sostituita da autore e licenza verificati, oppure il modello va cambiato.
Lo stesso filtro che ha già escluso DamagedHelmet (CC BY-NC, vieta l'uso
commerciale) e Duck (licenza proprietaria Sony) va applicato a questi.

**Nota sulle licenze scartate.** Fra i candidati c'erano anche *DamagedHelmet*
(CC BY-NC 4.0: vieta l'uso commerciale) e *Duck* (SCEA Shared Source, licenza
proprietaria Sony). Entrambi esclusi.

### Come sono stati preparati

I file in `public/models/` sono ricomposti dagli originali:

- le texture erano 2048×2048 per **59 MB** in tutto → ridotte a **256×256**
  (a questa distanza è già più del necessario): 2,4 MB
- geometria e materiali PBR sono intatti — colore, normali, metallo, ruvidità

Scartati anche *ChronographWatch* e *ToyCar*: 100.000 triangoli l'uno, che con
60 pezzi in scatola farebbero 6 milioni di triangoli per fotogramma.

### Set precedente

Il gioco ha usato il **Food Kit di Kenney** ([kenney.nl](https://kenney.nl/assets/food-kit),
CC0): 12 oggetti in 212 KB, tinte piatte da una palette condivisa. Più leggero e
più leggibile a schermo piccolo, ma senza texture dipinte. Lo storico del
repository lo conserva.

## Librerie

- [three.js](https://threejs.org) — MIT
- [Rapier](https://rapier.rs) — Apache-2.0 (`@dimforge/rapier3d-compat`)
- [Vite](https://vite.dev) — MIT
