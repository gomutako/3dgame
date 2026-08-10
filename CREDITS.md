# Crediti

## Modelli 3D

Gli oggetti che cadono nella scatola vengono dai **glTF Sample Assets** di
**Khronos** — [github.com/KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets).

| Modello | Autore | Licenza |
|---|---|---|
| Avocado | Public | CC0 1.0 |
| BoomBox | Public | CC0 1.0 |
| WaterBottle | Public | CC0 1.0 |
| AntiqueCamera | UX3D | CC0 1.0 (+ logo UX3D, marchio) |
| Corset | UX3D | CC0 1.0 |
| SunglassesKhronos | Darmstadt Graphics Group GmbH | CC BY 4.0 (+ logo Khronos, marchio) |

**Nota sui marchi.** AntiqueCamera e SunglassesKhronos contengono logo di UX3D e
Khronos. Il *contenuto* è CC0 / CC BY, ma il logo resta un marchio dei rispettivi
titolari: non è utilizzabile per suggerire una loro approvazione del gioco. Se il
progetto diventa un prodotto, questi due vanno sostituiti.

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
