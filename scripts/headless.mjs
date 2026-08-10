/**
 * Ponte per far girare il gioco in Node, senza browser.
 *
 * Serve solo agli harness: il codice dell'applicazione resta pulito.
 * Tre sostituzioni: il timer dei frame; il caricatore di file, perché GLTFLoader
 * usa `fetch`, che in Node non legge dal filesystem; e il caricatore di immagini,
 * perché senza DOM non esiste — headless non si disegna nulla, la texture serve
 * solo a non far fallire il parsing.
 */
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadItemTypes } from '../src/scene/shapes.js';

const PUBLIC = new URL('../public/', import.meta.url);

export async function setupHeadless() {
  globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 0);

  THREE.FileLoader.prototype.load = function (url, onLoad, _onProgress, onError) {
    const path = fileURLToPath(new URL('.' + url, PUBLIC));
    readFile(path).then(
      (buf) => onLoad(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
      (err) => (onError ? onError(err) : console.error(err))
    );
  };

  // GLTFLoader tocca `self.URL` mentre risolve le immagini: in Node `self` non c'è.
  globalThis.self ??= globalThis;

  THREE.ImageLoader.prototype.load = function (_url, onLoad) {
    onLoad({ width: 1, height: 1 });
    return {};
  };

  await loadItemTypes();
}

/** HUD muto per gli harness. */
export const silentHud = {
  setLevel() {}, setProgress() {}, setBoosters() {},
  setLoading() {}, showResult() {}, hideResult() {}, toast() {},
};
