// A `FileSystemDirectoryHandle` is structured-cloneable, so IndexedDB is the only place it
// survives a reload — localStorage takes strings only. Raw IndexedDB rather than the `idb`
// package: one database, one object store, one key does not justify a dependency.

const DATABASE_NAME = 'npcanvas'
const STORE_NAME = 'handles'
const ROOT_KEY = 'root-directory'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('Could not open the NPCanvas IndexedDB database'))
    }
    // Another tab holds an open connection at an older version. Nothing to do but fail:
    // the caller falls back to `disconnected`, which asks for the folder again.
    request.onblocked = () => {
      reject(new Error('Another NPCanvas tab is blocking the local handle database'))
    }
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = run(transaction.objectStore(STORE_NAME))
      // Commit, not request success: for a readwrite `put`, `onsuccess` fires *before* the
      // transaction commits, so an abort after that point — quota, storage pressure — would
      // be invisible and `saveDirectoryHandle` would report a handle that is not on disk.
      // `request.result` is settled by the time the transaction completes.
      transaction.oncomplete = () => {
        resolve(request.result)
      }
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('IndexedDB transaction was aborted'))
      }
      // Fires before the abort it causes, so the specific failure wins the rejection.
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB request failed'))
      }
    })
  } finally {
    database.close()
  }
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, ROOT_KEY))
}

export async function readDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const stored = await withStore<unknown>('readonly', (store) => store.get(ROOT_KEY))
  // The clone round trip preserves the prototype, so `instanceof` is a real check — and it
  // rejects whatever an older build might have left in this slot instead of trusting it.
  return stored instanceof FileSystemDirectoryHandle ? stored : null
}

export async function clearDirectoryHandle(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(ROOT_KEY))
}
