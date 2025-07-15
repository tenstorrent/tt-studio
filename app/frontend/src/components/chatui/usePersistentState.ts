// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import * as IndexedDB from "./indexedDBManager";

// Constants for limiting data
const MAX_THREADS = 20;
const MAX_MESSAGES_PER_THREAD = 100;

// Flag to track if migration has been attempted
let migrationAttempted = false;

// Key to track if migration has been completed
const MIGRATION_COMPLETED_KEY = "indexeddb_migration_completed";

export function usePersistentState<T>(
  key: string,
  initialValue: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  // Use a ref to track if we've loaded from storage yet
  const hasLoadedRef = useRef(false);
  // Use a ref to track if we're currently saving to avoid race conditions
  const isSavingRef = useRef(false);
  // Use a ref to track the latest state value to ensure we always save the most recent state
  const latestStateRef = useRef<T>(initialValue);

  const [state, setState] = useState<T>(() => {
    // Try to get from localStorage synchronously for initial render
    try {
      const localStorageValue = localStorage.getItem(key);
      if (localStorageValue) {
        try {
          return JSON.parse(localStorageValue);
        } catch (parseError) {
          // console.log(`Initial value for ${key} is not valid JSON`);
          // For non-JSON values, we'll fall back to initialValue and let the async load handle it
        }
      }
    } catch (e) {
      console.error(
        `Error reading initial value from localStorage for ${key}:`,
        e,
      );
    }
    return initialValue;
  });

  // Update the latest state ref whenever state changes
  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  // Load state from storage on mount
  useEffect(() => {
    let isMounted = true;

    const loadFromStorage = async () => {
      if (hasLoadedRef.current) return;

      try {
        // Try to get from IndexedDB first
        const storedValue = await IndexedDB.getItem<T>(key);

        if (storedValue !== null && isMounted) {
          // console.log(`Loaded ${key} from IndexedDB:`, storedValue);
          setState(storedValue);
          hasLoadedRef.current = true;
          return;
        }

        // If not in IndexedDB, try localStorage as fallback
        try {
          const localStorageValue = localStorage.getItem(key);
          if (localStorageValue && isMounted) {
            let parsedValue;

            try {
              parsedValue = JSON.parse(localStorageValue);
            } catch (parseError) {
              // console.log(`Value for ${key} is not valid JSON, using as string`);
              parsedValue = localStorageValue;
            }

            // Save to IndexedDB for future use
            await IndexedDB.setItem(key, parsedValue);
            // console.log(`Migrated ${key} from localStorage to IndexedDB`);

            if (isMounted) {
              setState(parsedValue as T);
              hasLoadedRef.current = true;
            }
          }
        } catch (localStorageError) {
          console.error(
            `Error reading from localStorage for ${key}:`,
            localStorageError,
          );
        }
      } catch (error) {
        console.error(`Error loading state for ${key}:`, error);
      }
    };

    // Only attempt migration if it hasn't been completed yet
    if (!migrationAttempted) {
      migrationAttempted = true;

      // Check if migration has already been completed
      try {
        const migrationCompleted =
          localStorage.getItem(MIGRATION_COMPLETED_KEY) === "true";

        if (!migrationCompleted) {
          // Perform migration
          // console.log("Starting one-time migration from localStorage to IndexedDB...");
          IndexedDB.migrateFromLocalStorage()
            .then(() => {
              // Mark migration as completed
              localStorage.setItem(MIGRATION_COMPLETED_KEY, "true");
              // console.log("Migration from localStorage to IndexedDB completed successfully");
            })
            .catch((err) => {
              console.error(
                "Error during migration from localStorage to IndexedDB:",
                err,
              );
            });
        } else {
          // console.log("IndexedDB migration already completed, skipping");
        }
      } catch (e) {
        console.error("Error checking migration status:", e);
      }
    }

    loadFromStorage();

    return () => {
      isMounted = false;
    };
  }, [key]);

  const pruneData = useCallback(
    (data: any): any => {
      if (!Array.isArray(data)) return data;

      try {
        if (key === "chat_threads") {
          let prunedData = [...data];
          if (prunedData.length > MAX_THREADS) {
            // console.log(`Pruning threads from ${prunedData.length} to ${MAX_THREADS}`);
            prunedData = prunedData.slice(-MAX_THREADS);
          }

          // Then limit messages per thread
          prunedData = prunedData.map((thread) => {
            if (
              thread &&
              thread.messages &&
              Array.isArray(thread.messages) &&
              thread.messages.length > MAX_MESSAGES_PER_THREAD
            ) {
              return {
                ...thread,
                messages: thread.messages.slice(-MAX_MESSAGES_PER_THREAD),
              };
            }
            return thread;
          });

          return prunedData;
        }

        if (data.length > 100) {
          return data.slice(-Math.floor(data.length * 0.7));
        }

        return data;
      } catch (error) {
        console.error("Error pruning data:", error);
        return data;
      }
    },
    [key],
  );

  // Function to save state to IndexedDB with error handling
  const saveToStorage = useCallback(async () => {
    // Avoid saving if we're already in the process of saving
    if (isSavingRef.current) return;

    // Mark that we're saving
    isSavingRef.current = true;

    try {
      // Always use the latest state from the ref to avoid race conditions
      const stateToSave = latestStateRef.current;
      // console.log(`Saving ${key} to IndexedDB:`, stateToSave);

      // Try to save to IndexedDB
      await IndexedDB.setItem(key, stateToSave);
    } catch (error) {
      console.warn(
        `Error saving to IndexedDB for ${key}, attempting to prune data:`,
        error,
      );

      try {
        // Try to prune the data and save again
        const prunedState = pruneData(latestStateRef.current);
        try {
          await IndexedDB.setItem(key, prunedState);
          // console.log(`Successfully saved pruned data to IndexedDB for ${key}`);
          // Update the state to match the pruned version if needed
          if (
            JSON.stringify(prunedState) !==
            JSON.stringify(latestStateRef.current)
          ) {
            setState(prunedState as T);
          }
        } catch (innerError) {
          console.error(
            `Still cannot save to IndexedDB after pruning for ${key}:`,
            innerError,
          );

          // As a last resort, try localStorage
          try {
            localStorage.setItem(key, JSON.stringify(prunedState));
            // console.log(`Saved ${key} to localStorage as fallback`);
          } catch (localStorageError) {
            console.error(
              `Failed to save ${key} to localStorage fallback:`,
              localStorageError,
            );
          }
        }
      } catch (pruneError) {
        console.error(`Error during data pruning for ${key}:`, pruneError);
      }
    } finally {
      // Mark that we're done saving
      isSavingRef.current = false;
    }
  }, [key, pruneData]);

  // Custom setState function that updates state and saves to storage
  const setStateAndSave = useCallback(
    (newState: React.SetStateAction<T>) => {
      setState((prevState) => {
        // Calculate the new state
        const nextState =
          typeof newState === "function"
            ? (newState as (prevState: T) => T)(prevState)
            : newState;

        // Update the latest state ref immediately
        latestStateRef.current = nextState;

        // Save the new state to storage
        saveToStorage();

        return nextState;
      });
    },
    [saveToStorage],
  );

  return [state, setStateAndSave];
}
