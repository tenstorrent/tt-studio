// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useState, useEffect, useCallback } from "react";

// Constants for limiting data
const MAX_THREADS = 20;
const MAX_MESSAGES_PER_THREAD = 100;

export function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const storedValue = localStorage.getItem(key);
      return storedValue ? JSON.parse(storedValue) : initialValue;
    } catch (error) {
      console.error(
        `Error loading state from localStorage for key ${key}:`,
        error
      );
      return initialValue;
    }
  });

  const pruneData = useCallback(
    (data: any): any => {
      if (!Array.isArray(data)) return data;

      try {
        if (key === "chat_threads") {
          let prunedData = [...data];
          if (prunedData.length > MAX_THREADS) {
            console.log(
              `Pruning threads from ${prunedData.length} to ${MAX_THREADS}`
            );
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
    [key]
  );

  // Function to save state to localStorage with error handling
  const saveToStorage = useCallback(
    (newState: T) => {
      try {
        const serializedState = JSON.stringify(newState);
        localStorage.setItem(key, serializedState);
      } catch (error) {
        // Handle quota exceeded error
        if (
          error instanceof DOMException &&
          error.name === "QuotaExceededError"
        ) {
          console.warn("Storage quota exceeded, attempting to prune data");

          try {
            // Try to prune the data and save again
            const prunedState = pruneData(newState);
            try {
              localStorage.setItem(key, JSON.stringify(prunedState));
              console.log("Successfully saved pruned data");
              // Update the state to match the pruned version
              setState(prunedState as T);
            } catch (innerError) {
              console.error("Still cannot save after pruning:", innerError);

              // Last resort: clear localStorage
              if (
                innerError instanceof DOMException &&
                innerError.name === "QuotaExceededError"
              ) {
                console.warn("Clearing localStorage as last resort");
                try {
                  // Save current keys to restore later (except the problematic one)
                  const keysToRestore: Record<string, string> = {};
                  for (let i = 0; i < localStorage.length; i++) {
                    const storageKey = localStorage.key(i);
                    if (storageKey && storageKey !== key) {
                      keysToRestore[storageKey] =
                        localStorage.getItem(storageKey) || "";
                    }
                  }

                  // Clear storage
                  localStorage.clear();

                  // Restore other keys
                  Object.entries(keysToRestore).forEach(([k, v]) => {
                    try {
                      localStorage.setItem(k, v);
                    } catch (restoreError) {
                      console.error(
                        `Failed to restore key ${k}:`,
                        restoreError
                      );
                    }
                  });

                  // Try to save our pruned state
                  try {
                    localStorage.setItem(key, JSON.stringify(prunedState));
                    console.log(
                      "Successfully saved after clearing localStorage"
                    );
                  } catch (finalError) {
                    console.error(
                      "Failed to save even after clearing localStorage:",
                      finalError
                    );
                  }
                } catch (clearError) {
                  console.error("Failed to clear localStorage:", clearError);
                }
              }
            }
          } catch (pruneError) {
            console.error("Error during data pruning:", pruneError);
          }
        } else {
          console.error(
            `Error saving state to localStorage for key ${key}:`,
            error
          );
        }
      }
    },
    [key, pruneData]
  );

  // Save state to localStorage whenever it changes
  useEffect(() => {
    saveToStorage(state);
  }, [state, saveToStorage]);

  return [state, setState];
}
