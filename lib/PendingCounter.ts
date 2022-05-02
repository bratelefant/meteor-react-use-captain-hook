import { Tracker } from 'meteor/tracker';

export class PendingCounter {
  private _zeroDep = new Tracker.Dependency();
  private _valueDep = new Tracker.Dependency();
  _value = 0;
  _total = 0;

  inc(by = 1): void {
    this._value += by;
    this._total += by;
    this._valueDep.changed();
    if (this._value === by) this._zeroDep.changed();
  }

  dec(by = 1): void {
    this._value -= by;
    this._valueDep.changed();
    if (this._value === 0) {
      this._zeroDep.changed();
      // this._total = 0;
    }
  }

  isZero(): boolean {
    this._zeroDep.depend();
    return this._value === 0;
  }

  value(): number {
    this._valueDep.depend();
    return this._value;
  }

  total(): number {
    this._valueDep.depend();
    return this._total;
  }
}
