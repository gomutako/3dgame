/**
 * Vassoio: 5 slot, inserimento auto-raggruppante.
 * Il pezzo si posiziona sempre accanto ai suoi simili, così il giocatore
 * conta gruppi invece che posizioni (DESIGN.md §5).
 */
export class Tray {
  constructor(slots = 5) {
    this.slots = slots;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  get isFull() {
    return this.items.length >= this.slots;
  }

  canAccept() {
    return this.items.length < this.slots;
  }

  types() {
    return this.items.map((i) => i.type);
  }

  countOf(type) {
    return this.items.reduce((n, i) => n + (i.type === type ? 1 : 0), 0);
  }

  /**
   * @returns {{pos:number, before:object[], matched:object[]|null}}
   *   `before` = disposizione visiva subito dopo l'inserimento, prima del match.
   */
  insert(item) {
    let pos = this.items.length;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].type === item.type) {
        pos = i + 1;
        break;
      }
    }

    this.items.splice(pos, 0, item);
    const before = this.items.slice();

    const same = this.items.filter((x) => x.type === item.type);
    let matched = null;
    if (same.length === 3) {
      matched = same;
      this.items = this.items.filter((x) => x.type !== item.type);
    }

    return { pos, before, matched };
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    return i;
  }

  clear() {
    this.items = [];
  }
}
