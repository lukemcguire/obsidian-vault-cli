/**
 * Stub for @/common/KeyValueDB — provides an in-memory KeyValueDatabase for headless Node.js usage.
 */
import type { KeyValueDatabase } from "../../livesync-commonlib/src/interfaces/KeyValueDatabase.ts";

class InMemoryKeyValueDB implements KeyValueDatabase {
    private store = new Map<IDBValidKey, any>();

    async get<T>(key: IDBValidKey): Promise<T> {
        return this.store.get(key) as T;
    }

    async set<T>(key: IDBValidKey, value: T): Promise<IDBValidKey> {
        this.store.set(key, value);
        return key;
    }

    async del(key: IDBValidKey): Promise<void> {
        this.store.delete(key);
    }

    async clear(): Promise<void> {
        this.store.clear();
    }

    async keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]> {
        return Array.from(this.store.keys());
    }

    async close(): Promise<void> {
        // no-op
    }

    async destroy(): Promise<void> {
        this.store.clear();
    }
}

export async function OpenKeyValueDatabase(name: string): Promise<KeyValueDatabase> {
    return new InMemoryKeyValueDB();
}
