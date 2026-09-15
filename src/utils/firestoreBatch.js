import { writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

const BATCH_LIMIT = 450;

export class BatchSplit {
  constructor() {
    this._batches = [writeBatch(db)];
    this._count = 0;
  }

  _current() {
    if (this._count >= BATCH_LIMIT) {
      this._batches.push(writeBatch(db));
      this._count = 0;
    }
    return this._batches[this._batches.length - 1];
  }

  set(ref, data) { this._current().set(ref, data); this._count++; }
  update(ref, data) { this._current().update(ref, data); this._count++; }
  delete(ref) { this._current().delete(ref); this._count++; }

  async commit() {
    for (const b of this._batches) await b.commit();
  }
}
