import Dexie from "dexie";
import { EJSON } from "meteor/ejson";
import type { Mongo } from "meteor/mongo";
import type { Meteor } from "meteor/meteor";
import { Tracker } from "meteor/tracker";
import { throttle } from "underscore";
import { PendingCounter } from "./PendingCounter";

export const waitUntilReactive = (condition: () => any): Promise<any> => {
  return new Promise((resolve) => {
    Tracker.autorun((comp: Tracker.Computation) => {
      const result = condition();
      if (result) {
        comp.stop();
        resolve(result);
      }
    });
  });
};

interface LocalCollectionInternal {
  queries: Record<any, any>;
  _recomputeResults: (query: unknown) => void;
  _observeQueue: { drain: () => void };
  _docs: {
    has: (key: string) => boolean;
    set: (key: string, value: any) => void;
    get: (key: string) => any;
    remove: (key: string) => any;
    clear: () => void;
    _map: Map<string, any>;
  };
}

export interface GroundedDocumentCompressor<T, O = Record<string, any>> {
  compress: (doc: T) => O;
  decompress: (doc: O) => T;
}

const strId = (id: string | { _str: string }) =>
  typeof id == "object" ? id._str : id;

// Global helper for applying grounddb on a collection
export class GroundedCollection<T extends Record<string, any> & { _id: string }>
  implements Mongo.Collection<T>
{
  table: Dexie.Table;

  private idField: string | undefined;
  private _collection: Mongo.Collection<T> & LocalCollectionInternal;
  private invalidate: () => void;
  private compressor?: GroundedDocumentCompressor<T>;
  pendingWrites = new PendingCounter();
  pendingReads = new PendingCounter();

  constructor(
    name: string,
    options: {
      version?: number;
      idField?: string;
      collection?: Mongo.Collection<T>;
      compressor?: GroundedDocumentCompressor<T>;
    } = {}
  ) {
    if (typeof name !== "string" || name == "") {
      throw new Error("GroundedCollection requires a collection name");
    }

    //@ts-expect-error Using undocumented internal _collection property
    this._collection = (
      options.collection || new Mongo.Collection(null)
    )._collection;

    // Test assumptions about internal Meteor stuff
    if (
      !(this._collection._docs._map instanceof Map) ||
      !this._collection.queries ||
      !(typeof this._collection._recomputeResults == "function") ||
      !(typeof this._collection._observeQueue?.drain == "function")
    ) {
      throw new Error(
        "LocalCollection internal API no longer compatible with GroundedCollection"
      );
    }

    this.find = this._collection.find.bind(this._collection);
    this.findOne = this._collection.findOne.bind(this._collection);

    this.idField = options.idField;

    const dexie = new Dexie(name);
    dexie
      .version(options.version || 1)
      .stores({ keyvaluepairs: "" /* outbound primary key */ });
    this.table = dexie.table("keyvaluepairs");

    // Create invalidator
    const invalidationDelayTime = 60; // this used to be an option
    this.invalidate = createThrottledInvalidater(
      this._collection,
      invalidationDelayTime
    );

    this.compressor = options.compressor;

    this.loadDatabase();
  }

  /**
   * Loads data from local storage
   */
  private async loadDatabase(): Promise<void> {
    this.pendingReads.inc(1); // prevent immediate "isZero"
    const idsToLoad = (await this.table.toCollection().primaryKeys()).filter(
      (id) => !this._collection._docs.has(id)
    );
    if (idsToLoad.length === 0) {
      this.pendingReads.dec(1); // reverses .inc(1) above
      this.setLoaded();
    } else {
      this.pendingReads.inc(idsToLoad.length - 1);
      // Dexie bulkGet returns Array that matches input order
      const docsToLoad = await this.table.bulkGet(idsToLoad);
      idsToLoad.forEach((id, index) => {
        let docToLoad: Record<string, any> | null = docsToLoad[index];
        if (docToLoad) {
          if (this.compressor)
            docToLoad = this.compressor.decompress(docToLoad);
          docToLoad._id = id;
          if (this.idField) docToLoad[this.idField] = id;
          this._collection._docs.set(id, EJSON.fromJSONValue(docToLoad));
        }
      });
      this.invalidate();
      this.pendingReads.dec(idsToLoad.length);
      this.setLoaded();
    }
  }

  private isLoaded = false;
  private loadedDep = new Tracker.Dependency();
  loaded(): boolean {
    this.loadedDep.depend();
    return this.isLoaded;
  }
  waitUntilLoaded(): Promise<void> {
    return new Promise((resolve) => {
      Tracker.autorun((comp: Tracker.Computation) => {
        if (!this.loaded()) return;
        comp.stop();
        resolve();
      });
    });
  }

  private setLoaded(): void {
    this.isLoaded = true;
    this.loadedDep.changed();
  }

  saveDocumentToMemory(doc: T): void {
    const docToSave = EJSON.clone(doc);
    if (this.idField) docToSave._id = strId(docToSave[this.idField]);
    this._collection._docs.set(docToSave._id, docToSave);
    this.invalidate();
  }

  removeDocumentFromMemory(doc: T): void {
    this._collection._docs.remove(this.idField ? doc[this.idField] : doc._id);
    this.invalidate();
  }

  async saveDocumentToStorage(doc: T | undefined): Promise<void> {
    if (!doc)
      throw new Error(
        "Undefined document passed to GroundedCollection.saveDocument"
      );
    this.pendingWrites.inc();
    const id = strId(this.idField ? doc[this.idField] : doc._id);
    const docToSave = EJSON.toJSONValue(this.compressor?.compress(doc) || doc);
    delete docToSave._id;
    if (this.idField) delete docToSave[this.idField];
    // Check for existing document, since writing takes waaay longer than reading
    const existingDoc = (await this.table.get(id)) as
      | Record<string, any>
      | undefined;
    if (!(existingDoc && EJSON.equals(docToSave, existingDoc))) {
      await this.table.put(docToSave, id);
    }
    this.pendingWrites.dec();
  }

  async saveBulkDocumentsToStorage(docs: T[]): Promise<void> {
    this.pendingWrites.inc(docs.length);
    const docsToSave: Record<string, any>[] = [];
    const idsToSave: string[] = [];
    const fetchedDocs = await this.table.bulkGet(
      docs.map((doc) => doc[this.idField || "_id"])
    );
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const fetchedDoc = fetchedDocs[i];
      const id = strId(doc[this.idField || "_id"]);
      const docToSave = EJSON.toJSONValue(
        this.compressor?.compress(doc) || doc
      );
      delete docToSave._id;
      if (this.idField) delete docToSave[this.idField];
      if (!(fetchedDoc && EJSON.equals(docToSave, fetchedDoc))) {
        docsToSave.push(docToSave);
        idsToSave.push(id);
      }
    }
    await this.table.bulkPut(docsToSave, idsToSave);
    this.pendingWrites.dec(docs.length);
  }

  async removeDocumentFromStorage(
    docOrId: Record<string, any> | string
  ): Promise<void> {
    if (!docOrId)
      throw new Error("Undefined passed to GroundedCollection.removeDocument");
    this.pendingWrites.inc();
    const id =
      typeof docOrId == "string"
        ? docOrId
        : strId(this.idField ? docOrId[this.idField] : docOrId._id);
    await this.table.delete(id);
    this.pendingWrites.dec();
  }

  observeSource(
    source: GroundedCollection<T> | Mongo.Collection<T> | Mongo.Cursor<T> = this
  ): Meteor.LiveQueryHandle {
    // Make sure to remove previous source handle if found
    this.stopObserver();

    const cursor = "observe" in source ? source : source.find();
    let initialRun = true;
    this.saveBulkDocumentsToStorage(cursor.fetch());
    const sourceHandle = cursor.observe({
      added: (doc: T) => {
        if (this !== source) this.saveDocumentToMemory(doc);
        if (initialRun) return;
        this.saveDocumentToStorage(doc);
      },
      changed: (doc: T, _oldDoc: T) => {
        if (this !== source) this.saveDocumentToMemory(doc);
        this.saveDocumentToStorage(doc);
      },
      removed: (doc: T) => {
        if (this !== source) this.removeDocumentFromMemory(doc);
        this.removeDocumentFromStorage(doc);
      },
    });
    initialRun = false;
    this.sourceHandle = sourceHandle;

    return {
      stop: sourceHandle.stop,
    };
  }

  private sourceHandle?: any;

  stopObserver(): void {
    if (this.sourceHandle) {
      this.sourceHandle.stop();
      this.sourceHandle = undefined;
    }
  }

  shutdown(): Promise<void> {
    // TODO: This should disallow further writes after being called.
    return new Promise((resolve) => {
      Tracker.autorun((comp) => {
        if (this.pendingWrites.isZero()) {
          comp.stop();
          resolve();
        }
      });
    });
  }

  clear(): void {
    this.table.clear();
    this._collection._docs.clear();
    this.invalidate();
  }

  /**
   * Match the contents of the ground db to that of a cursor, or an array of cursors.
   */
  keep(...cursors: Mongo.Cursor<T>[]): void {
    const iteratorOfCurrentIds = this._collection._docs._map.keys();
    const idsToKeep = new Set(
      cursors.flatMap((cursor) =>
        cursor.map((doc: T) =>
          strId(this.idField ? doc[this.idField] : doc._id)
        )
      )
    );
    // Remove all other documents from the collection
    for (const id of iteratorOfCurrentIds) {
      if (!idsToKeep.has(id)) {
        // Remove it from in memory
        this._collection._docs.remove(id);
        // Remove it from storage
        this.removeDocumentFromStorage(id);
      }
    }
    this.invalidate();
  }

  find: (
    selector?: string | Mongo.Query<T>,
    options?: Record<string, any>
  ) => Mongo.Cursor<T>;
  findOne: (
    selector?: string | Mongo.Query<T>,
    options?: Record<string, any>
  ) => T | undefined;

  insert(doc: Mongo.OptionalId<T>): string {
    if (!doc._id) delete doc._id; // otherwise minimongo will happily set _id to undefined
    if (this.idField) doc._id = doc[this.idField];
    const id = this._collection.insert(doc);
    this.saveDocumentToStorage(this._collection.findOne(id));
    return id;
  }

  upsert(
    selector: Mongo.Selector<T> | Mongo.ObjectID | string,
    modifier: Mongo.Modifier<T>
  ): {
    numberAffected?: number | undefined;
    insertedId?: string | undefined;
  } {
    const result = this._collection.upsert(selector, modifier);
    this.saveDocumentToStorage(this._collection.findOne(selector));
    return result;
  }

  update(
    selector: string | Mongo.ObjectID | Mongo.Selector<T>,
    modifier: Mongo.Modifier<T>
  ): number {
    const result = this._collection.update(selector, modifier);
    this.saveDocumentToStorage(this._collection.findOne(selector));
    return result;
  }

  remove(selector: string | Mongo.ObjectID | Mongo.Selector<T>): number {
    const docs = this._collection
      .find(selector, { fields: { [this.idField || "_id"]: 1 } })
      .fetch();
    docs.forEach((doc: T) => {
      this.removeDocumentFromStorage(doc);
    });
    return this._collection.remove(selector);
  }

  allow = unimplementedFunction;
  deny = unimplementedFunction;
  rawCollection = unimplementedFunction;
  rawDatabase = unimplementedFunction;
  createIndex = unimplementedFunction;
  _ensureIndex = unimplementedFunction;
  _dropIndex = unimplementedFunction;
}

const unimplementedFunction = (): any => {
  throw new Error("Not implemented");
};

/*
  This function returns a throttled invalidation function binded on a collection
 */
const createThrottledInvalidater = (
  _collection: LocalCollectionInternal,
  wait = 100
) => {
  return throttle(() => {
    Object.keys(_collection.queries).forEach((qid) => {
      const query = _collection.queries[qid];
      if (query) _collection._recomputeResults(query);
    });
    _collection._observeQueue.drain();
  }, wait);
};
