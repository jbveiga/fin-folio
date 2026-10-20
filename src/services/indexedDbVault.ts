const DB_NAME = "finfolio_vault_db";
const DB_VERSION = 1;
const STORE_NAME = "vault_store";
const VAULT_KEY = "vault_state";
export const LEGACY_STORAGE_KEY = "finfolio_preview_vault_v1";

export interface StorageInfo {
  engine:
    | "IndexedDB (500MB+ High Capacity)"
    | "LocalStorage (Legacy 5MB)"
    | "Tauri SQLCipher (Encrypted SQLite)";
  isIndexedDbSupported: boolean;
  isUsingIndexedDb: boolean;
  estimatedBytes: number;
  quotaBytes: number;
  accountCount: number;
  categoryCount: number;
  entityCount: number;
  transactionCount: number;
}

export class IndexedDbVaultAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private activeBackend: "indexeddb" | "localstorage" = "indexeddb";

  public isSupported(): boolean {
    return typeof window !== "undefined" && "indexedDB" in window && window.indexedDB !== null;
  }

  public isUsingIndexedDb(): boolean {
    return this.isSupported() && this.activeBackend === "indexeddb";
  }

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        if (!this.isSupported()) {
          this.activeBackend = "localstorage";
          return reject(new Error("IndexedDB is not supported in this browser."));
        }
        try {
          const req = window.indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME);
            }
          };
          req.onsuccess = () => {
            this.activeBackend = "indexeddb";
            resolve(req.result);
          };
          req.onerror = () => {
            this.activeBackend = "localstorage";
            reject(req.error || new Error("IndexedDB open error"));
          };
        } catch (err) {
          this.activeBackend = "localstorage";
          reject(err);
        }
      });
    }
    return this.dbPromise;
  }

  public async loadVaultFromIndexedDb<T>(): Promise<T | null> {
    if (!this.isSupported()) {
      this.activeBackend = "localstorage";
      return this.loadFromLegacyLocalStorage<T>();
    }

    try {
      const db = await this.open();
      const state = await new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(VAULT_KEY);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
      });

      if (state) {
        return state;
      }

      // Transparent One-Time Auto-Migration from legacy localStorage
      const legacy = this.loadFromLegacyLocalStorage<T>();
      if (legacy) {
        await this.saveVaultToIndexedDb(legacy);
        return legacy;
      }

      return null;
    } catch (err) {
      console.warn("IndexedDB load failed, falling back to localStorage:", err);
      this.activeBackend = "localstorage";
      return this.loadFromLegacyLocalStorage<T>();
    }
  }

  public async saveVaultToIndexedDb<T>(state: T): Promise<void> {
    if (!this.isSupported()) {
      this.activeBackend = "localstorage";
      this.saveToLegacyLocalStorage(state);
      return;
    }

    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(state, VAULT_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      this.activeBackend = "indexeddb";
    } catch (err) {
      console.warn("IndexedDB save failed, falling back to localStorage:", err);
      this.activeBackend = "localstorage";
      this.saveToLegacyLocalStorage(state);
    }
  }

  public async resetVaultInIndexedDb(): Promise<void> {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
    if (this.isSupported()) {
      try {
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(VAULT_KEY);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.warn("IndexedDB reset failed:", err);
      }
    }
  }

  public loadFromLegacyLocalStorage<T>(): T | null {
    if (typeof window === "undefined" || !window.localStorage) return null;
    try {
      const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  public saveToLegacyLocalStorage<T>(state: T): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("LocalStorage quota exceeded:", e);
    }
  }
}

export const indexedDbVault = new IndexedDbVaultAdapter();
