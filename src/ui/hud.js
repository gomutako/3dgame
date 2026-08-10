/** Sottile strato DOM sopra il canvas: HUD, booster, modale di fine livello. */
export class Hud {
  constructor({ onUndo, onHint, onShuffle, onContinue }) {
    this.el = {
      level: document.getElementById('level-num'),
      fill: document.getElementById('progress-fill'),
      label: document.getElementById('progress-label'),
      loader: document.getElementById('loader'),
      overlay: document.getElementById('overlay'),
      title: document.getElementById('overlay-title'),
      text: document.getElementById('overlay-text'),
      button: document.getElementById('overlay-btn'),
      undo: document.getElementById('btn-undo'),
      hint: document.getElementById('btn-hint'),
      shuffle: document.getElementById('btn-shuffle'),
      undoCount: document.getElementById('undo-count'),
      hintCount: document.getElementById('hint-count'),
      shuffleCount: document.getElementById('shuffle-count'),
      toast: document.getElementById('toast'),
    };

    this.el.undo.addEventListener('click', onUndo);
    this.el.hint.addEventListener('click', onHint);
    this.el.shuffle.addEventListener('click', onShuffle);
    this.el.button.addEventListener('click', () => {
      this.hideResult();
      onContinue(this.result);
    });
  }

  /** Messaggio breve sopra i pulsanti; si dissolve da solo. */
  toast(message, ms = 2600) {
    this.el.toast.textContent = message;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.add('hidden'), ms);
  }

  setLevel(n) {
    this.el.level.textContent = n;
  }

  setProgress(done, total) {
    this.el.fill.style.width = `${total ? (done / total) * 100 : 0}%`;
    this.el.label.textContent = `${done} / ${total}`;
  }

  setBoosters({ undo, hint, shuffle }) {
    this.el.undoCount.textContent = undo;
    this.el.hintCount.textContent = hint;
    this.el.shuffleCount.textContent = shuffle;
    this.el.undo.disabled = undo <= 0;
    this.el.hint.disabled = hint <= 0;
    this.el.shuffle.disabled = shuffle <= 0;
  }

  setLoading(on) {
    this.el.loader.classList.toggle('hidden', !on);
  }

  showResult(kind, level) {
    this.result = kind;
    const win = kind === 'win';
    this.el.title.textContent = win ? 'Livello completato' : 'Scomparti pieni';
    this.el.text.textContent = win
      ? `Scatola svuotata. Il livello ${level + 1} è più affollato.`
      : 'Nessuno spazio libero nel vassoio. Riprova: il livello è lo stesso.';
    this.el.button.textContent = win ? 'Continua' : 'Riprova';
    this.el.overlay.classList.remove('hidden');
  }

  hideResult() {
    this.el.overlay.classList.add('hidden');
  }
}
