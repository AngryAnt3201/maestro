/**
 * Persists additional directories per Claude session UUID using Tauri's LazyStore.
 * This allows directories to survive app restarts and be restored when resuming sessions.
 *
 * Storage key: "session-dirs"
 * Shape: Record<string, string[]>  (claude session UUID → list of additional dirs)
 */

import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("session-dirs.json");
const STORE_KEY = "session-dirs";

type SessionDirsMap = Record<string, string[]>;

async function getAll(): Promise<SessionDirsMap> {
  try {
    return (await store.get<SessionDirsMap>(STORE_KEY)) ?? {};
  } catch {
    return {};
  }
}

async function saveAll(map: SessionDirsMap): Promise<void> {
  await store.set(STORE_KEY, map);
  await store.save();
}

/** Gets the persisted additional directories for a Claude session. */
export async function getSessionDirs(claudeSessionId: string): Promise<string[]> {
  const map = await getAll();
  return map[claudeSessionId] ?? [];
}

/** Adds a directory to a Claude session's persisted list. */
export async function addSessionDir(claudeSessionId: string, dir: string): Promise<void> {
  const map = await getAll();
  const dirs = map[claudeSessionId] ?? [];
  if (!dirs.includes(dir)) {
    map[claudeSessionId] = [...dirs, dir];
    await saveAll(map);
  }
}

/** Removes all persisted directories for a Claude session (e.g., on delete). */
export async function removeSessionDirs(claudeSessionId: string): Promise<void> {
  const map = await getAll();
  if (claudeSessionId in map) {
    delete map[claudeSessionId];
    await saveAll(map);
  }
}
