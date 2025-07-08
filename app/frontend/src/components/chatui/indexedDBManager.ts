// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// Constants for database configuration
const DB_NAME = "tt-studio-chat";
const DB_VERSION = 1;
const STORE_NAME = "persistent-state";

// Interface for stored items
interface StoredItem {
  key: string;
  value: any;
}

/**
 * Opens a connection to the IndexedDB database
 * @returns Promise with the database connection
 */
export const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("Error opening IndexedDB:", event);
      reject(new Error("Could not open IndexedDB"));
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("key", "key", { unique: true });
      }
    };
  });
};

/**
 * Gets an item from IndexedDB
 * @param key The key to retrieve
 * @returns Promise with the value or null if not found
 */
export const getItem = async <T>(key: string): Promise<T | null> => {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = (event) => {
        console.error(`Error getting item with key ${key}:`, event);
        reject(new Error(`Failed to get item with key ${key}`));
      };

      request.onsuccess = (event) => {
        const result = (event.target as IDBRequest).result;
        if (result) {
          resolve(result.value);
        } else {
          resolve(null);
        }
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error("IndexedDB getItem error:", error);
    return null;
  }
};

/**
 * Sets an item in IndexedDB
 * @param key The key to set
 * @param value The value to store
 * @returns Promise that resolves when the operation is complete
 */
export const setItem = async <T>(key: string, value: T): Promise<void> => {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const item: StoredItem = { key, value };
      const request = store.put(item);

      request.onerror = (event) => {
        console.error(`Error setting item with key ${key}:`, event);
        reject(new Error(`Failed to set item with key ${key}`));
      };

      request.onsuccess = () => {
        resolve();
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error("IndexedDB setItem error:", error);
    throw error;
  }
};

/**
 * Removes an item from IndexedDB
 * @param key The key to remove
 * @returns Promise that resolves when the operation is complete
 */
export const removeItem = async (key: string): Promise<void> => {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onerror = (event) => {
        console.error(`Error removing item with key ${key}:`, event);
        reject(new Error(`Failed to remove item with key ${key}`));
      };

      request.onsuccess = () => {
        resolve();
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error("IndexedDB removeItem error:", error);
    throw error;
  }
};

/**
 * Clears all items from the store
 * @returns Promise that resolves when the operation is complete
 */
export const clearStore = async (): Promise<void> => {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = (event) => {
        console.error("Error clearing store:", event);
        reject(new Error("Failed to clear store"));
      };

      request.onsuccess = () => {
        resolve();
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error("IndexedDB clearStore error:", error);
    throw error;
  }
};

/**
 * Gets all keys in the store
 * @returns Promise with an array of keys
 */
export const getAllKeys = async (): Promise<string[]> => {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onerror = (event) => {
        console.error("Error getting all keys:", event);
        reject(new Error("Failed to get all keys"));
      };

      request.onsuccess = (event) => {
        const result = (event.target as IDBRequest).result;
        resolve(result as string[]);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error("IndexedDB getAllKeys error:", error);
    return [];
  }
};

/**
 * Migrates data from localStorage to IndexedDB
 * @returns Promise that resolves when migration is complete
 */
export const migrateFromLocalStorage = async (): Promise<void> => {
  try {
    // Get all keys from localStorage
    const keys = Object.keys(localStorage);

    // Migrate each item
    for (const key of keys) {
      try {
        const value = localStorage.getItem(key);
        if (value) {
          let parsedValue;

          try {
            // Try to parse as JSON
            parsedValue = JSON.parse(value);
          } catch (parseError) {
            // If parsing fails, store the raw string value
            console.log(
              `Value for key ${key} is not valid JSON, storing as string`,
            );
            parsedValue = value;
          }

          // Store in IndexedDB
          await setItem(key, parsedValue);
          console.log(`Migrated ${key} from localStorage to IndexedDB`);
        }
      } catch (error) {
        console.error(`Error migrating ${key}:`, error);
      }
    }

    console.log("Migration from localStorage to IndexedDB complete");
  } catch (error) {
    console.error("Migration error:", error);
    throw error;
  }
};
