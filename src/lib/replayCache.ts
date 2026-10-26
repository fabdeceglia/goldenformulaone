import type { ReplayData } from './replay'

/**
 * A replay downloaded through the OpenF1 fallback is cached in IndexedDB, so a
 * second visit is instant even if no baked asset exists. Baked files are left
 * to the HTTP cache: they are already static and small.
 */
const DB_NAME = 'box-this-lap'
const STORE = 'replays'
const CACHE_VERSION = 8

interface StoredReplay {
  v: number
  savedAt: number
  data: ReplayData
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
    // "no cache" rather than an error the replay has to handle.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return promise
}

function db(): Promise<IDBDatabase | null> {
  database ??= openDatabase()
  return database
}

export async function readReplayCache(sessionKey: number): Promise<ReplayData | null> {
  const connection = await db()
  if (!connection) return null

  return new Promise((resolve) => {
    try {
      const transaction = connection.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(sessionKey)
      request.onsuccess = () => {
        const stored = request.result as StoredReplay | undefined
        resolve(stored && stored.v === CACHE_VERSION ? stored.data : null)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function writeReplayCache(sessionKey: number, data: ReplayData): Promise<void> {
  const connection = await db()
  if (!connection) return

  return new Promise((resolve) => {
    try {
      const transaction = connection.transaction(STORE, 'readwrite')
      const stored: StoredReplay = { v: CACHE_VERSION, savedAt: Date.now(), data }
      transaction.objectStore(STORE).put(stored, sessionKey)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}
