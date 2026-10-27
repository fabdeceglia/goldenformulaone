import type { QualifyingBattle } from './battle'

/**
 * Battles are small (about 180 KB for four feeds) but the cold load still makes
 * six requests. This cache keeps a repeat battle instant. It lives in its own
 * database so it can never block or upgrade the race-replay cache.
 */
const DB_NAME = 'box-this-lap-battles'
const STORE = 'battles'
const CACHE_VERSION = 1

interface StoredBattle {
  v: number
  savedAt: number
  data: QualifyingBattle
}

let database: Promise<IDBDatabase | null> | null = null

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  const promise = new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    // Private browsing and blocked storage are normal enough to treat as
    // "no cache" rather than an error the battle has to handle.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return promise
}

function db(): Promise<IDBDatabase | null> {
  database ??= openDatabase()
  return database
}

export async function readBattleCache(key: string): Promise<QualifyingBattle | null> {
  const connection = await db()
  if (!connection) return null

  return new Promise((resolve) => {
    try {
      const transaction = connection.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(key)
      request.onsuccess = () => {
        const stored = request.result as StoredBattle | undefined
        resolve(stored && stored.v === CACHE_VERSION ? stored.data : null)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function writeBattleCache(
  key: string,
  data: QualifyingBattle,
): Promise<void> {
  const connection = await db()
  if (!connection) return

  return new Promise((resolve) => {
    try {
      const transaction = connection.transaction(STORE, 'readwrite')
      const stored: StoredBattle = { v: CACHE_VERSION, savedAt: Date.now(), data }
      transaction.objectStore(STORE).put(stored, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
